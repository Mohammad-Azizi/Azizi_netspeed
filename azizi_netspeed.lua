module("luci.controller.azizi_netspeed", package.seeall)

local json = require "luci.jsonc"

function index()
    entry({"admin", "status", "azizi_netspeed"},
          template("azizi_netspeed"),
          _("Realtime Speed"),
          1)

    entry({"admin", "status", "realtime", "azizi_netspeed_data"},
          call("get_data_json"),
          nil,
          nil).template = false
end

function get_data_json()
    luci.http.prepare_content("application/json")
    
    local up_json = luci.sys.exec("nft -j list set inet azizi_netspeed_counters up_per_ip 2>/dev/null || echo '{\"nftables\":[]}'")
    local down_json = luci.sys.exec("nft -j list set inet azizi_netspeed_counters down_per_ip 2>/dev/null || echo '{\"nftables\":[]}'")
    
    local data = {
        up_counters = json.parse(up_json).nftables or {},
        down_counters = json.parse(down_json).nftables or {}
    }
    
    luci.http.write(json.stringify(data))
end