

# luci-app-azizi-netspeed

Per-device network speed and bandwidth monitor for OpenWrt

![OpenWrt](https://img.shields.io/badge/OpenWrt-24.10+-green?logo=openwrt)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Architecture](https://img.shields.io/badge/arch-all-lightgrey)
![Release](https://img.shields.io/github/v/release/Mohammad-Azizi/Azizi_netspeed?color=orange)

---

## What is this?

Azizi_NetSpeed adds a real-time network monitor to the OpenWrt LuCI interface. It shows per-device upload/download speeds and total data usage using nftables kernel counters, running entirely on the router with minimal overhead.

I built this because I needed something lightweight enough to run on an Archer C50 v6 (8MB flash, single-core MIPS, 64MB RAM) without slowing anything down. Most monitoring tools are way too heavy for that kind of hardware.

![Dashboard Preview](./screenshot/image1.jpg)

## Features

- **Live per-device speeds** — see who's downloading what, right now
- **Total usage tracking** — bytes and packet counts per IP, reset daily
- **Online/offline status** — based on actual nftables timeout expiry, not guesswork
- **Yesterday's usage** — collapsible panel showing archived data from the previous day
- **Mobile friendly** — responsive layout, works fine on phone browsers
- **Zero background processes** — no daemons, no polling scripts, everything runs in-kernel
- **Tiny footprint** — the whole package is under 8KB installed

## How it works

The package integrates with fw4 by adding nftables sets to track per-IP traffic using kernel counters. The LuCI interface reads these counters periodically and calculates real-time speeds without background processes.

A daily cron job saves usage data and resets counters for the next cycle.

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
opkg install luci-app-azizi-netspeed_*_all.ipk
```

That's it. No extra configuration needed. The firewall restarts automatically during install to load the nftables rules.

## Screenshots

### Real-time dashboard

Live speed display with online/offline status tags. Devices are sorted by current activity — the heaviest user is always at the top.

![Live Dashboard](./screenshots/image2.jpg)

### Yesterday's archived data

Click the "Yesterday's Total Usage" bar to expand the full breakdown. Data is saved automatically at 11:59 PM and counters reset for the new day.

### Mobile view

Same dashboard, same data, just reformatted for small screens. No separate mobile app needed.

![Mobile View](./screenshots/image3.jpg)

## Configuration

### Changing the daily reset time

The default reset runs at 11:59 PM. To change it:

1. Go to **System** → **Scheduled Tasks** in LuCI
2. Find the line containing `azizi_netspeed_save`
3. Edit the cron schedule to your preference

```
# Default: run at 11:59 PM every day
59 23 * * * /root/azizi_netspeed_save

# Example: run at 6:00 AM instead
0 6 * * * /root/azizi_netspeed_save
```

### Adjusting the timeout window

By default, devices that haven't sent any traffic for 24 hours are automatically removed from the tracking sets (to save memory).


## Uninstalling

```bash
opkg remove luci-app-azizi-netspeed
```

## FAQ

**Does this slow down my router?**

No. The nftables counters run inside the kernel's packet processing pipeline — they add virtually zero overhead. The JavaScript frontend only runs when you have the page open in your browser.


**Will I lose today's data if I reboot the router?**

Yes. The live counters are stored in kernel memory (nftables sets) and are cleared on reboot. Yesterday's archived data is saved to `/root/` which survive reboots

**Does this work with VLANs or multiple LANs?**

The default rules track traffic on `br-lan`. If you have additional bridge interfaces, you can add extra rules in `/etc/nftables.d/azizi_monitor.nft` for each interface.

## Contributing

Found a bug? Have an idea? Open an issue or submit a pull request. I'm happy to review contributions of any size.


## Support the project

If this tool is useful to you, the best way to support it is to ⭐ star the repo and share it with other OpenWrt users. That's it — no donations, no subscriptions, just word of mouth.

## License

Apache License 2.0 — see [LICENSE](./LICENSE) for details.

---

Built by [Mohammad Azizi](https://github.com/Mohammad-Azizi) for routers that deserve better monitoring tools.