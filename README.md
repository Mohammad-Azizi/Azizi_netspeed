

# luci-app-azizi-netspeed

Per-device network speed and bandwidth monitor for OpenWrt. No cloud, no dependencies, no bloat.

![OpenWrt](https://img.shields.io/badge/OpenWrt-24.10+-green?logo=openwrt)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Architecture](https://img.shields.io/badge/arch-all-lightgrey)
![Release](https://img.shields.io/github/v/release/Mohammad-Azizi/Azizi_netspeed?color=orange)

---

## What is this?

If you've ever wondered "who's eating all the bandwidth?" on your home network, this is for you.

Azizi NetSpeed adds a dashboard to your OpenWrt router's LuCI interface that shows real-time upload/download speeds and total data usage for every device on your network. It runs entirely on the router using nftables kernel counters — no external server, no packet sniffing, no performance hit.

I built this because I needed something lightweight enough to run on an Archer C50 v6 (8MB flash, single-core MIPS, 64MB RAM) without slowing anything down. Most monitoring tools are way too heavy for that kind of hardware.

![Dashboard Preview](./assets/dashboard.png)

## Features

- **Live per-device speeds** — see who's downloading what, right now
- **Total usage tracking** — bytes and packet counts per IP, reset daily
- **Online/offline status** — based on actual nftables timeout expiry, not guesswork
- **Yesterday's usage** — collapsible panel showing archived data from the previous day
- **Auto light/dark theme** — follows your system preference via `prefers-color-scheme`
- **Mobile friendly** — responsive layout, works fine on phone browsers
- **Zero background processes** — no daemons, no polling scripts, everything runs in-kernel
- **Tiny footprint** — the whole package is under 15KB installed

## How it works

The package injects two nftables dynamic sets (`up_per_ip` and `down_per_ip`) into the existing `fw4` firewall table via `/etc/nftables.d/`. Every packet passing through the `forward` chain gets its source or destination IP added to the appropriate set with a byte/packet counter.

On the frontend, a LuCI JavaScript view polls `nft -j list set` every 3 seconds and calculates the speed by comparing byte counts between intervals. No shell scripts run in the background — the browser does all the math.

A single cron job runs at 11:59 PM to dump the current counters to JSON files in `/tmp/` and flush the sets for the next day. That's it.

```
┌─────────────┐     nftables sets      ┌──────────────┐
│   Devices    │ ───── forward ──────▶  │  up_per_ip   │
│  on br-lan   │                        │  down_per_ip │
└─────────────┘                         └──────┬───────┘
                                               │
                                    nft -j list set (every 3s)
                                               │
                                        ┌──────▼───────┐
                                        │   LuCI JS    │
                                        │  Dashboard   │
                                        └──────────────┘
```

## Requirements

- OpenWrt 22.03 or later (fw4/nftables-based)
- `luci-base` (comes with any LuCI install)
- `firewall4` and `nftables-json` (standard on modern OpenWrt)

If your router runs OpenWrt with LuCI, you almost certainly have everything you need.

## Installation

### Option A: Web interface

1. Download the latest `.ipk` from the [Releases](https://github.com/Mohammad-Azizi/Azizi_netspeed/releases) page
2. Open your router's admin panel → **System** → **Software**
3. Click **Upload Package**, select the file, and install
4. Refresh the page — "NetSpeed" will appear in the top navigation menu

### Option B: SSH

```bash
# Upload the file to your router first (via scp, sftp, etc.)
cd /tmp
opkg install luci-app-azizi-netspeed_2.0_all.ipk
```

That's it. No extra configuration needed. The firewall restarts automatically during install to load the nftables rules.

## Screenshots

### Real-time dashboard

Live speed display with online/offline status tags. Devices are sorted by current activity — the heaviest user is always at the top.

![Live Dashboard](./assets/dashboard.png)

### Yesterday's archived data

Click the "Yesterday's Total Usage" bar to expand the full breakdown. Data is saved automatically at 11:59 PM and counters reset for the new day.

![Yesterday Panel](./assets/history.png)

### Mobile view

Same dashboard, same data, just reformatted for small screens. No separate mobile app needed.

![Mobile View](./assets/mobile.png)

## Configuration

### Changing the daily reset time

The default reset runs at 11:59 PM. To change it:

1. Go to **System** → **Scheduled Tasks** in LuCI
2. Find the line containing `azizi_netspeed_save`
3. Edit the cron schedule to your preference

```
# Default: run at 11:59 PM every day
59 23 * * * /usr/bin/azizi_netspeed_save

# Example: run at 6:00 AM instead
0 6 * * * /usr/bin/azizi_netspeed_save
```

### Adjusting the timeout window

By default, devices that haven't sent any traffic for 24 hours are automatically removed from the tracking sets (to save memory). You can change this by editing `/etc/nftables.d/azizi_monitor.nft`:

```
set up_per_ip {
    type ipv4_addr
    flags dynamic, timeout
    timeout 48h        # <-- change this value
    counter
}
```

Then restart the firewall: `service firewall restart`

## Uninstalling

```bash
opkg remove luci-app-azizi-netspeed
```

The uninstall script automatically:
- Removes the cron job (without touching your other scheduled tasks)
- Flushes and deletes the nftables sets and chain
- Cleans up saved data files

## FAQ

**Does this slow down my router?**

No. The nftables counters run inside the kernel's packet processing pipeline — they add virtually zero overhead. The JavaScript frontend only runs when you have the dashboard page open in your browser.

**Why do some devices show as IP addresses instead of names?**

The hostname comes from your router's DHCP lease table. If a device uses a static IP or hasn't renewed its lease recently, it might not have a hostname entry. You can assign friendly names under **Network** → **DHCP and DNS** → **Static Leases**.

**Will I lose today's data if I reboot the router?**

Yes. The live counters are stored in kernel memory (nftables sets) and are cleared on reboot. Yesterday's archived data is saved to `/tmp/` which is also RAM-based. If you need data to survive reboots, you can change the save path in `/usr/bin/azizi_netspeed_save` to a mounted USB drive.

**Does this work with VLANs or multiple LANs?**

The default rules track traffic on `br-lan`. If you have additional bridge interfaces, you can add extra rules in `/etc/nftables.d/azizi_monitor.nft` for each interface.

**What about IPv6?**

Currently, only IPv4 traffic is tracked. IPv6 support is planned for a future release.

## File structure

```
/etc/nftables.d/azizi_monitor.nft          # nftables rules (sets + chain)
/usr/bin/azizi_netspeed_save               # Daily archival script (called by cron)
/usr/share/luci/menu.d/luci-app-azizi-netspeed.json    # LuCI menu entry
/usr/share/rpcd/acl.d/luci-app-azizi-netspeed.json     # ACL permissions
/www/luci-static/resources/view/azizi_netspeed/         # Frontend JS + assets
/tmp/azizi_netspeed_yu/                    # Archived JSON data (created at runtime)
```

## Contributing

Found a bug? Have an idea? Open an issue or submit a pull request. I'm happy to review contributions of any size.

If you're testing changes locally, the fastest workflow is:
1. Edit the JS file directly on the router: `/www/luci-static/resources/view/azizi_netspeed/monitor.js`
2. Hard-refresh your browser (Ctrl+Shift+R)
3. No need to rebuild the package for frontend changes

## Support the project

If this tool is useful to you, the best way to support it is to ⭐ star the repo and share it with other OpenWrt users. That's it — no donations, no subscriptions, just word of mouth.

## License

Apache License 2.0 — see [LICENSE](./LICENSE) for details.

---

Built by [Mohammad Azizi](https://github.com/Mohammad-Azizi) for routers that deserve better monitoring tools.