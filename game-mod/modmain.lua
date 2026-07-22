local GLOBAL = GLOBAL
local json = GLOBAL.require("json")
local io = GLOBAL.io
local math = GLOBAL.math
local pairs = GLOBAL.pairs
local pcall = GLOBAL.pcall
local string = GLOBAL.string
local table = GLOBAL.table
local tostring = GLOBAL.tostring
local tonumber = GLOBAL.tonumber
local type = GLOBAL.type

local STATE_PATH = "unsafedata/dont_starve_ai_mod_state.json"
local REQUEST_PATH = "unsafedata/dont_starve_ai_mod_requests.json"
local REPLY_PATH = "unsafedata/dont_starve_ai_mod_reply.json"
-- DST only permits writes to selected extensions in unsafedata.  Keeping this
-- as .txt is important: a .log file silently fails to open and hides exactly
-- the diagnostics needed when the input bridge does not start.
local LUA_LOG_PATH = "unsafedata/dont_starve_ai_mod_lua.txt"
local RPC_NAMESPACE = "dont_starve_ai_mod"
local STATE_VERSION = 2
local VOICE_KEY = GLOBAL.KEY_V or 118
local CHESTER_SLOT_COUNTS = { [9] = true, [18] = true, [27] = true, [36] = true }
local CHESTER_SLOTS = tonumber(GetModConfigData("chester_slots")) or 9
if not CHESTER_SLOT_COUNTS[CHESTER_SLOTS] then
    CHESTER_SLOTS = 9
end

local last_reply_id = ""
local voice_key_down = false
local key_handlers_installed = false
local request_sequence = 0

local function configure_chester_container(slot_count)
    local containers = GLOBAL.require("containers")
    local slots = CHESTER_SLOT_COUNTS[slot_count] and slot_count or 9
    local widget = containers.params.chester.widget
    local columns = slots <= 9 and 3 or (slots <= 18 and 6 or 9)
    local rows = math.ceil(slots / columns)
    local spacing = 80

    widget.slotpos = {}
    for row = rows - 1, 0, -1 do
        for column = 0, columns - 1 do
            if #widget.slotpos >= slots then
                break
            end
            table.insert(
                widget.slotpos,
                GLOBAL.Vector3(
                    (column - (columns - 1) / 2) * spacing,
                    (row - (rows - 1) / 2) * spacing,
                    0
                )
            )
        end
    end
    widget.pos = GLOBAL.Vector3(0, 200, 0)
    widget.side_align_tip = math.max(160, columns * spacing / 2 + 40)
    if slots > 9 then
        -- There is no matching 9x3 Chester frame in the base game's UI
        -- assets. Hide the fixed 3x3 frame so the expanded slot grid is
        -- visually consistent instead of leaving a small frame in its centre.
        widget.bganim_visualfn = function(anim)
            anim:Hide()
        end
    else
        widget.bganim_visualfn = function(anim)
            anim:Show()
        end
    end
    -- Clients initially load their local Mod options, which may not match a
    -- hosted world's settings. Always allocate the maximum possible pool;
    -- the actual UI size is synchronized per Chester below.
    containers.MAXITEMSLOTS = math.max(containers.MAXITEMSLOTS or 0, 36)
end

configure_chester_container(CHESTER_SLOTS)

local function diagnostic(message)
    local timestamp = GLOBAL.os ~= nil and GLOBAL.os.time ~= nil and GLOBAL.os.time() or 0
    local text = tostring(message)
    print("[Chester AI] " .. text)

    local file = io.open(LUA_LOG_PATH, "a")
    if file ~= nil then
        file:write("[" .. tostring(timestamp) .. "] " .. text .. "\n")
        file:close()
    end
end

local function round(value, places)
    if type(value) ~= "number" then
        return nil
    end
    local scale = 10 ^ (places or 0)
    return math.floor(value * scale + 0.5) / scale
end

local function get_replica_value(entity, component_name, method_name)
    local component = entity ~= nil
        and entity.replica ~= nil
        and entity.replica[component_name]
        or nil
    if component == nil or component[method_name] == nil then
        return nil
    end
    local ok, value = pcall(component[method_name], component)
    return ok and value or nil
end

local function item_snapshot(item)
    if item == nil then
        return nil
    end

    local stack = 1
    if item.replica ~= nil and item.replica.stackable ~= nil then
        local ok, value = pcall(item.replica.stackable.StackSize, item.replica.stackable)
        if ok and value ~= nil then
            stack = value
        end
    end

    local display_name = item.prefab or "unknown"
    if item.GetDisplayName ~= nil then
        local ok, value = pcall(item.GetDisplayName, item)
        if ok and value ~= nil and value ~= "" then
            display_name = value
        end
    end

    return {
        prefab = item.prefab or "unknown",
        name = display_name,
        stack = stack,
    }
end

local function inventory_snapshot(player)
    local result = { items = {}, equipped = {}, active = nil }
    local inventory = player ~= nil
        and player.replica ~= nil
        and player.replica.inventory
        or nil
    if inventory == nil then
        return result
    end

    local ok_items, items = pcall(inventory.GetItems, inventory)
    if ok_items and type(items) == "table" then
        for _, item in pairs(items) do
            local value = item_snapshot(item)
            if value ~= nil then
                table.insert(result.items, value)
            end
        end
    end

    local ok_equips, equips = pcall(inventory.GetEquips, inventory)
    if ok_equips and type(equips) == "table" then
        for slot, item in pairs(equips) do
            local value = item_snapshot(item)
            if value ~= nil then
                value.slot = tostring(slot)
                table.insert(result.equipped, value)
            end
        end
    end

    local ok_active, active = pcall(inventory.GetActiveItem, inventory)
    if ok_active then
        result.active = item_snapshot(active)
    end
    return result
end

local function find_chester_near_position(x, y, z)
    if GLOBAL.TheSim == nil then
        return nil
    end
    local ok, entities = pcall(
        GLOBAL.TheSim.FindEntities,
        GLOBAL.TheSim,
        x,
        y,
        z,
        80,
        { "chester" },
        { "INLIMBO" }
    )
    if not ok or type(entities) ~= "table" or #entities == 0 then
        return nil
    end
    return entities[1]
end

local function find_chester_near_player(player)
    if player == nil or player.Transform == nil then
        return nil
    end
    local x, y, z = player.Transform:GetWorldPosition()
    return find_chester_near_position(x, y, z)
end

local function find_or_create_player_chester(player)
    if player == nil or player.Transform == nil or player.userid == nil then
        return nil, false
    end

    local x, y, z = player.Transform:GetWorldPosition()
    -- This runs only when a player enters. Search the whole playable world so
    -- a Chester that was left behind is reclaimed instead of duplicating it.
    local candidates = GLOBAL.TheSim:FindEntities(x, y, z, 10000, { "chester" }, { "INLIMBO" })
    local fallback = nil
    for _, candidate in pairs(candidates) do
        local follower = candidate.components ~= nil and candidate.components.follower or nil
        if candidate._chester_ai_owner_userid == player.userid
            or (follower ~= nil and follower.leader == player) then
            return candidate, false
        end
        if fallback == nil and candidate._chester_ai_owner_userid == nil then
            fallback = candidate
        end
    end

    if fallback ~= nil then
        return fallback, false
    end

    local chester = GLOBAL.SpawnPrefab("chester")
    if chester ~= nil and chester.Transform ~= nil then
        chester.Transform:SetPosition(x, y, z)
        return chester, true
    end
    return nil, false
end

local function remove_player_eyebones(player)
    local inventory = player ~= nil and player.components ~= nil and player.components.inventory or nil
    if inventory == nil then
        return 0
    end

    local removed = 0
    while true do
        local eyebone = inventory:FindItem(function(item)
            return item ~= nil and item.prefab == "chester_eyebone"
        end)
        if eyebone == nil then
            break
        end
        inventory:RemoveItem(eyebone, true)
        eyebone:Remove()
        removed = removed + 1
    end
    return removed
end

local function ensure_player_chester(player)
    if player == nil or player.components == nil then
        return
    end
    local chester, created = find_or_create_player_chester(player)
    if chester == nil or chester.components == nil or chester.components.follower == nil then
        diagnostic("unable to assign Chester for player=" .. tostring(player.userid))
        return
    end

    chester._chester_ai_owner_userid = player.userid
    chester.components.follower:SetLeader(player)
    local removed = remove_player_eyebones(player)
    diagnostic(
        "Chester assigned: player=" .. tostring(player.userid)
            .. "; created=" .. tostring(created)
            .. "; removed_eyebones=" .. tostring(removed)
    )
end

local function find_chester_near_any_player()
    for _, player in pairs(GLOBAL.AllPlayers or {}) do
        local chester = find_chester_near_player(player)
        if chester ~= nil then
            return chester
        end
    end
    return nil
end

local function chester_snapshot(player_x, player_y, player_z)
    local result = { present = false }
    local chester = find_chester_near_position(player_x, player_y, player_z)
    if chester == nil or chester.Transform == nil then
        return result
    end

    local x, y, z = chester.Transform:GetWorldPosition()
    local dx = x - player_x
    local dz = z - player_z
    result.present = true
    result.guid = chester.GUID
    result.distance = round(math.sqrt(dx * dx + dz * dz), 1)
    result.position = { x = round(x, 1), y = round(y, 1), z = round(z, 1) }
    result.health_percent = round(get_replica_value(chester, "health", "GetPercent"), 3)
    result.is_dead = chester:HasTag("isdead")
    result.variant = chester:HasTag("shadow_aligned") and "shadow"
        or (chester:HasTag("fridge") and "snow" or "normal")

    local container = chester.replica ~= nil and chester.replica.container or nil
    if container ~= nil and container.GetNumSlots ~= nil then
        local ok_slots, slots = pcall(container.GetNumSlots, container)
        if ok_slots and type(slots) == "number" then
            local occupied = 0
            result.container_slots = slots
            for slot = 1, slots do
                local ok_item, item = pcall(container.GetItemInSlot, container, slot)
                if ok_item and item ~= nil then
                    occupied = occupied + 1
                end
            end
            result.container_occupied = occupied
        end
    end
    return result
end

local function nearby_snapshot(x, y, z)
    local nearby = {}
    if GLOBAL.TheSim == nil then
        return nearby
    end

    local ok, entities = pcall(
        GLOBAL.TheSim.FindEntities,
        GLOBAL.TheSim,
        x,
        y,
        z,
        12,
        nil,
        { "INLIMBO", "NOCLICK", "FX", "player", "chester" }
    )
    if not ok or type(entities) ~= "table" then
        return nearby
    end

    for _, entity in pairs(entities) do
        if #nearby >= 30 then
            break
        end
        if entity ~= nil and entity.prefab ~= nil and entity.Transform ~= nil then
            local ex, _, ez = entity.Transform:GetWorldPosition()
            local dx = ex - x
            local dz = ez - z
            table.insert(nearby, {
                prefab = entity.prefab,
                distance = round(math.sqrt(dx * dx + dz * dz), 1),
            })
        end
    end
    table.sort(nearby, function(a, b)
        return a.distance < b.distance
    end)
    return nearby
end

local function build_state()
    local player = GLOBAL.ThePlayer
    local world = GLOBAL.TheWorld
    if player == nil or world == nil or player.Transform == nil then
        return nil
    end

    local x, y, z = player.Transform:GetWorldPosition()
    local world_state = world.state or {}
    local player_name = player.name
    if (player_name == nil or player_name == "") and player.GetDisplayName ~= nil then
        local ok, value = pcall(player.GetDisplayName, player)
        if ok then
            player_name = value
        end
    end

    return {
        schema_version = STATE_VERSION,
        captured_at_unix = GLOBAL.os ~= nil and GLOBAL.os.time ~= nil and GLOBAL.os.time() or nil,
        game_time_seconds = round(GLOBAL.GetTime(), 2),
        player = {
            prefab = player.prefab,
            name = player_name,
            position = { x = round(x, 1), y = round(y, 1), z = round(z, 1) },
            health_percent = round(get_replica_value(player, "health", "GetPercent"), 3),
            hunger_percent = round(get_replica_value(player, "hunger", "GetPercent"), 3),
            sanity_percent = round(get_replica_value(player, "sanity", "GetPercent"), 3),
            moisture_percent = round(
                get_replica_value(player, "moisture", "GetMoisturePercent"),
                3
            ),
            temperature = round(get_replica_value(player, "temperature", "GetCurrent"), 1),
            inventory = inventory_snapshot(player),
        },
        world = {
            cycles = world_state.cycles,
            phase = world_state.phase,
            season = world_state.season,
            remaining_days_in_season = world_state.remainingdaysinseason,
            moon_phase = world_state.moonphase,
            is_full_moon = world_state.isfullmoon,
            is_raining = world_state.israining,
            is_snowing = world_state.issnowing,
            temperature = round(world_state.temperature, 1),
        },
        chester = chester_snapshot(x, y, z),
        nearby = nearby_snapshot(x, y, z),
    }
end

local function encode_json(value)
    local ok, encoded = pcall(json.encode_compliant, value)
    if not ok or encoded == nil then
        return nil, tostring(encoded)
    end
    return encoded, nil
end

local function write_json(path, value)
    local encoded, encode_error = encode_json(value)
    if encoded == nil then
        return false, "JSON encode failed: " .. tostring(encode_error)
    end

    local file = io.open(path, "w")
    if file == nil then
        return false, "io.open failed: " .. path
    end
    local ok, write_error = pcall(function()
        file:write(encoded)
    end)
    file:close()
    if not ok then
        return false, "write failed: " .. tostring(write_error)
    end
    return true, nil
end

local function read_json(path)
    local file = io.open(path, "r")
    if file == nil then
        return nil
    end
    local content = file:read("*a")
    file:close()
    if content == nil or content == "" then
        return nil
    end
    local ok, value = pcall(json.decode, content)
    return ok and value or nil
end

local function write_state()
    local state = build_state()
    if state ~= nil then
        write_json(STATE_PATH, state)
    end
end

local function write_recording_request(action)
    request_sequence = request_sequence + 1
    local timestamp = GLOBAL.os ~= nil and GLOBAL.os.time ~= nil and GLOBAL.os.time() or 0
    local event = {
        id = tostring(timestamp) .. "-" .. tostring(request_sequence),
        action = action,
        created_at_unix = timestamp,
        game_time_seconds = round(GLOBAL.GetTime(), 2),
        state = build_state(),
    }

    local document = read_json(REQUEST_PATH)
    if type(document) ~= "table" or type(document.events) ~= "table" then
        document = { schema_version = 1, events = {} }
    end
    table.insert(document.events, event)
    while #document.events > 100 do
        table.remove(document.events, 1)
    end
    return write_json(REQUEST_PATH, document)
end

local function ensure_request_document()
    local document = read_json(REQUEST_PATH)
    if type(document) == "table" and type(document.events) == "table" then
        return true, nil
    end
    return write_json(REQUEST_PATH, { schema_version = 1, events = {} })
end

local function show_chester_status(player, status)
    local chester = find_chester_near_player(player)
    if chester == nil then
        diagnostic("cannot show " .. status .. ": no Chester within 80 units")
        return
    end
    if chester.components == nil or chester.components.talker == nil then
        diagnostic("cannot show " .. status .. ": Chester talker component unavailable")
        return
    end

    if status == "listening" then
        chester.components.talker:Say("正在聆听……", 30, nil, true)
    elseif status == "thinking" then
        chester.components.talker:Say("我在思考……", 30, nil, true)
    end
    diagnostic("Chester status shown: " .. status)
end

AddModRPCHandler(RPC_NAMESPACE, "chester_status", function(player, status)
    diagnostic(
        "status RPC received: status=" .. tostring(status)
            .. "; player=" .. tostring(player ~= nil and player.prefab or "nil")
    )
    if status == "listening" or status == "thinking" then
        show_chester_status(player, status)
    end
end)

local function send_status(status)
    local rpc_namespace = MOD_RPC ~= nil and MOD_RPC[RPC_NAMESPACE] or nil
    local rpc = rpc_namespace ~= nil and rpc_namespace["chester_status"] or nil
    if rpc == nil then
        diagnostic("status RPC unavailable for " .. status)
        return
    end

    local ok, error_message = pcall(SendModRPCToServer, rpc, status)
    if ok then
        diagnostic("status RPC sent: " .. status)
    else
        diagnostic("status RPC failed: " .. tostring(error_message))
    end
end

local function on_voice_key_down()
    diagnostic(
        "V key-down callback: already_down=" .. tostring(voice_key_down)
            .. "; player=" .. tostring(GLOBAL.ThePlayer)
    )
    if voice_key_down or GLOBAL.ThePlayer == nil then
        return
    end

    voice_key_down = true
    local written, write_error = write_recording_request("start_recording")
    diagnostic(
        "start_recording request: written=" .. tostring(written)
            .. "; error=" .. tostring(write_error)
    )
    send_status("listening")
end

local function on_voice_key_up()
    diagnostic("V key-up callback: was_down=" .. tostring(voice_key_down))
    if not voice_key_down then
        return
    end

    voice_key_down = false
    local written, write_error = write_recording_request("stop_recording")
    diagnostic(
        "stop_recording request: written=" .. tostring(written)
            .. "; error=" .. tostring(write_error)
    )
    send_status("thinking")
end

local function install_voice_key_handlers()
    if key_handlers_installed then
        return true
    end
    if GLOBAL.TheInput == nil then
        diagnostic("key handler install deferred: TheInput is nil")
        return false
    end
    if GLOBAL.TheInput.AddKeyDownHandler == nil or GLOBAL.TheInput.AddKeyUpHandler == nil then
        diagnostic("key handler install failed: input handler methods unavailable")
        return false
    end

    diagnostic("installing V handlers: key=" .. tostring(VOICE_KEY))
    local ok_down, down_error = pcall(
        GLOBAL.TheInput.AddKeyDownHandler,
        GLOBAL.TheInput,
        VOICE_KEY,
        on_voice_key_down
    )
    local ok_up, up_error = pcall(
        GLOBAL.TheInput.AddKeyUpHandler,
        GLOBAL.TheInput,
        VOICE_KEY,
        on_voice_key_up
    )
    if not ok_down or not ok_up then
        diagnostic(
            "key handler install failed: down=" .. tostring(down_error)
                .. "; up=" .. tostring(up_error)
        )
        return false
    end

    key_handlers_installed = true
    diagnostic("V key handlers installed successfully; down=" .. tostring(ok_down)
        .. "; up=" .. tostring(ok_up))
    return true
end

local function show_reply()
    local reply = read_json(REPLY_PATH)
    if type(reply) ~= "table" or type(reply.id) ~= "string" or type(reply.text) ~= "string" then
        return
    end
    if reply.id == last_reply_id or reply.text == "" then
        return
    end
    last_reply_id = reply.id

    diagnostic("new Python reply: id=" .. reply.id .. "; length=" .. tostring(#reply.text))
    local chester = find_chester_near_any_player()
    if chester == nil then
        diagnostic("cannot show Python reply: no Chester near a player")
        return
    end
    if chester.components == nil or chester.components.talker == nil then
        diagnostic("cannot show Python reply: Chester talker component unavailable")
        return
    end
    chester.components.talker:Say(reply.text, 8, nil, true)
    diagnostic("Python reply shown by Chester")
end

local function ignore_reply_left_by_previous_session()
    local reply = read_json(REPLY_PATH)
    if type(reply) == "table" and type(reply.id) == "string" then
        last_reply_id = reply.id
        diagnostic("ignoring reply left by previous session: id=" .. reply.id)
    end
end

diagnostic("modmain loaded; schema=" .. tostring(STATE_VERSION) .. "; key=" .. tostring(VOICE_KEY))

AddSimPostInit(function()
    diagnostic(
        "sim initialized: TheInput=" .. tostring(GLOBAL.TheInput)
            .. "; dedicated=" .. tostring(GLOBAL.TheNet ~= nil and GLOBAL.TheNet:IsDedicated())
    )
    install_voice_key_handlers()
end)

AddPrefabPostInit("chester", function(inst)
    inst._chester_ai_slots = GLOBAL.net_tinybyte(
        inst.GUID,
        "chester_ai_slots",
        "chester_ai_slotsdirty"
    )

    if GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim then
        inst._chester_ai_slots:set(CHESTER_SLOTS)
    else
        local function synchronize_chester_container_ui(chester)
            local slots = chester._chester_ai_slots:value()
            if CHESTER_SLOT_COUNTS[slots] then
                configure_chester_container(slots)
                if chester.replica ~= nil and chester.replica.container ~= nil then
                    chester.replica.container:WidgetSetup("chester")
                end
                diagnostic("Chester container UI synchronized: slots=" .. tostring(slots))
            else
                diagnostic("Chester container UI waiting for server slots; value=" .. tostring(slots))
            end
        end

        inst:ListenForEvent("chester_ai_slotsdirty", synchronize_chester_container_ui)
        -- Initial net values may arrive before the dirty listener is installed.
        -- Read once more after the container classified replica is attached.
        inst:DoTaskInTime(1, synchronize_chester_container_ui)
    end

    -- Chester's vanilla prefab does not include talker.  The server component
    -- broadcasts the speech, but every client also needs its own local talker
    -- component to render the FollowText bubble (as ai_elf does before
    -- SetPristine in its prefab).
    if inst.components.talker == nil then
        inst:AddComponent("talker")
        -- The default FollowText offset (-400) floats noticeably too high over
        -- Chester's compact model. Screen-space Y is negative upwards.
        inst.components.talker.offset = GLOBAL.Vector3(0, -250, 0)
        diagnostic(
            "talker component added to Chester; master="
                .. tostring(GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim)
        )
    end

    if GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim then
        -- Chester is an AI companion, not a combat unit. Do not let hostile
        -- creatures select it, and make it immune to any incidental damage.
        inst:AddTag("notarget")
        if inst.components.health ~= nil then
            inst.components.health:SetInvincible(true)
        end

        local old_on_save = inst.OnSave
        inst.OnSave = function(chester, data)
            if old_on_save ~= nil then
                old_on_save(chester, data)
            end
            data.chester_ai_owner_userid = chester._chester_ai_owner_userid
        end

        local old_on_load = inst.OnLoad
        inst.OnLoad = function(chester, data)
            if old_on_load ~= nil then
                old_on_load(chester, data)
            end
            if data ~= nil then
                chester._chester_ai_owner_userid = data.chester_ai_owner_userid
            end
        end
    end
end)

AddPlayerPostInit(function(player)
    if GLOBAL.TheWorld == nil or not GLOBAL.TheWorld.ismastersim then
        return
    end
    player:DoTaskInTime(2, ensure_player_chester)
end)

AddPrefabPostInit("world", function(inst)
    local dedicated = GLOBAL.TheNet ~= nil and GLOBAL.TheNet:IsDedicated()
    local master = GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim
    diagnostic("world initialized: master=" .. tostring(master) .. "; dedicated=" .. tostring(dedicated))

    if not dedicated then
        local request_ready, request_error = ensure_request_document()
        diagnostic(
            "request document ready=" .. tostring(request_ready)
                .. "; error=" .. tostring(request_error)
        )
        inst:DoPeriodicTask(1, write_state, 1)
        inst:DoTaskInTime(1, function()
            if install_voice_key_handlers() then
                return
            end

            local retry_task = nil
            retry_task = inst:DoPeriodicTask(2, function()
                if install_voice_key_handlers() and retry_task ~= nil then
                    diagnostic("deferred V handler installation succeeded")
                    retry_task:Cancel()
                    retry_task = nil
                end
            end, 2)
        end)
    end

    if master then
        -- The reply bridge file survives game restarts. Mark its current value
        -- as already handled so Chester only says replies generated this session.
        ignore_reply_left_by_previous_session()
        inst:DoPeriodicTask(0.5, show_reply, 0.5)
    end
end)
