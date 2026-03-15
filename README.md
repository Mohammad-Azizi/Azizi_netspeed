# Azizi NetSpeed – Realtime Per-IP Bandwidth Monitor for OpenWrt

Lightweight realtime upload/download speed monitor per IP address using nftables dynamic counters.  
No extra packages required besides `luci-base`.

## Features
- Shows current speed (kb/s / Mb/s) and total transferred data per client IP
- Automatically detects LAN subnet from UCI (no hard-coded IP)
- Uses nftables dynamic sets → low overhead, auto-cleanup of inactive IPs
- Works on OpenWrt 22.03 / 23.05 / 24.10+
- Pure LuCI integration (appears under Status menu)

## Screenshots

<p align="center">
  <img src="screenshots/IMG_20260315_214640.jpg" alt="Azizi NetSpeed Realtime Monitor" width="100%">
  <br>
  <em>Realtime per-IP upload/download speeds in LuCI Status tab</em>
</p>


## Installation (manual)

```bash
# 1. Create directories
mkdir -p /usr/lib/lua/luci/controller /usr/lib/lua/luci/view/azizi_netspeed /etc/hotplug.d/iface

# 2. Copy files (use scp or wget from raw github urls later)
# ... copy azizi_netspeed.lua, realtime.htm, azizi_nft_generator.sh ...

# 3. Make script executable
chmod +x /etc/hotplug.d/iface/azizi_nft_generator.sh

# 4. Run generator once
/etc/hotplug.d/iface/azizi_nft_generator.sh

# 5. Refresh LuCI
rm -rf /tmp/luci-* && /etc/init.d/uhttpd restart
