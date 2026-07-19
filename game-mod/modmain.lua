local GLOBAL = GLOBAL
local json = GLOBAL.require("json")
local io = GLOBAL.io
local math = GLOBAL.math
local pairs = GLOBAL.pairs
local pcall = GLOBAL.pcall
local string = GLOBAL.string
local table = GLOBAL.table
local tostring = GLOBAL.tostring
local type = GLOBAL.type

local STATE_PATH = "unsafedata/dont_starve_ai_mod_state.json"
local REPLY_PATH = "unsafedata/dont_starve_ai_mod_reply.json"
local STATE_VERSION = 1
local last_reply_id = ""

local function round(value, places)
    if type(value) ~= "number" then
        return nil
    end
    local scale = 10 ^ (places or 0)
    return math.floor(value * scale + 0.5) / scale
end

local function get_replica_value(player, name, method)
    local component = player ~= nil and player.replica ~= nil and player.replica[name] or nil
    if component == nil or component[method] == nil then
        return nil
    end
    local ok, value = pcall(component[method], component)
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
    local inventory = player ~= nil and player.replica ~= nil and player.replica.inventory or nil
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

local function chester_snapshot(player, player_x, player_y, player_z)
    local result = { present = false }
    if GLOBAL.TheSim == nil then
        return result
    end

    local ok, entities = pcall(
        GLOBAL.TheSim.FindEntities,
        GLOBAL.TheSim,
        player_x,
        player_y,
        player_z,
        80,
        { "chester" },
        { "INLIMBO" }
    )
    if not ok or type(entities) ~= "table" or #entities == 0 then
        return result
    end

    local chester = entities[1]
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
        local occupied = 0
        local ok_slots, slots = pcall(container.GetNumSlots, container)
        if ok_slots then
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

local function nearby_snapshot(player, x, y, z)
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
        if entity ~= nil and entity.prefab ~= nil then
            local ex, _, ez = entity.Transform:GetWorldPosition()
            local dx = ex - x
            local dz = ez - z
            table.insert(nearby, {
                prefab = entity.prefab,
                distance = round(math.sqrt(dx * dx + dz * dz), 1),
            })
        end
    end
    table.sort(nearby, function(a, b) return a.distance < b.distance end)
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
    local temperature = get_replica_value(player, "temperature", "GetCurrent")
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
            moisture_percent = round(get_replica_value(player, "moisture", "GetMoisturePercent"), 3),
            temperature = round(temperature, 1),
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
        chester = chester_snapshot(player, x, y, z),
        nearby = nearby_snapshot(player, x, y, z),
    }
end

local function write_json(path, value)
    local ok_encode, encoded = pcall(json.encode_compliant, value)
    if not ok_encode or encoded == nil then
        return false
    end
    local file = io.open(path, "w")
    if file == nil then
        return false
    end
    file:write(encoded)
    file:close()
    return true
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

local function find_chester_near_players()
    for _, player in pairs(GLOBAL.AllPlayers or {}) do
        if player ~= nil and player.Transform ~= nil then
            local x, y, z = player.Transform:GetWorldPosition()
            local entities = GLOBAL.TheSim:FindEntities(x, y, z, 80, { "chester" }, { "INLIMBO" })
            if entities ~= nil and #entities > 0 then
                return entities[1]
            end
        end
    end
    return nil
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

    local chester = find_chester_near_players()
    if chester ~= nil and chester.components ~= nil and chester.components.talker ~= nil then
        chester.components.talker:Say(string.sub(reply.text, 1, 300), 6)
    end
end

local function give_eyebone_if_missing(player)
    if player == nil or player.components == nil or player.components.inventory == nil then
        return
    end
    local inventory = player.components.inventory
    local existing = inventory:FindItem(function(item)
        return item ~= nil and item.prefab == "chester_eyebone"
    end)
    if existing ~= nil then
        return
    end

    local eyebone = GLOBAL.SpawnPrefab("chester_eyebone")
    if eyebone ~= nil then
        inventory:GiveItem(eyebone)
        if player.components.talker ~= nil then
            player.components.talker:Say("切斯特来找你了。")
        end
    end
end

AddPlayerPostInit(function(inst)
    if GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim then
        inst:DoTaskInTime(2, give_eyebone_if_missing)
    end
end)

AddPrefabPostInit("chester", function(inst)
    if GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim and inst.components.talker == nil then
        inst:AddComponent("talker")
    end
end)

AddPrefabPostInit("world", function(inst)
    if not GLOBAL.TheNet:IsDedicated() then
        inst:DoPeriodicTask(1, write_state, 1)
    end
    if GLOBAL.TheWorld ~= nil and GLOBAL.TheWorld.ismastersim then
        inst:DoPeriodicTask(0.5, show_reply, 0.5)
    end
end)
