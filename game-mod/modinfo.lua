name = "Don't Starve AI Mod"
description = "Press V to talk with Chester through the desktop AI sidecar."
author = "Don't Starve AI Mod contributors"
version = "0.2.0"

api_version = 10
dst_compatible = true
client_only_mod = false
-- The client renders Chester's speech bubble and container slots, so it must
-- receive the world's capacity setting rather than using a local default.
all_clients_require_mod = true

server_filter_tags = { "chester", "ai", "voice" }

local function choice(description, data, hover)
    return { description = description, data = data, hover = hover }
end

configuration_options = {
    {
        name = "chester_slots",
        label = "切斯特格数",
        hover = "调整切斯特背包容量。更改后重启世界生效。",
        options = {
            choice("9 格（默认）", 9),
            choice("18 格", 18),
            choice("27 格", 27),
            choice("36 格", 36),
        },
        default = 9,
    },
}

icon_atlas = nil
icon = nil
