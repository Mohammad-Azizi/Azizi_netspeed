#!/bin/sh

# Allow manual run for testing
if [ -z "$ACTION" ] || [ -z "$INTERFACE" ]; then
    ACTION="ifup"
    INTERFACE="lan"
    echo "Running in manual test mode (simulating ifup lan)"
fi

[ "$ACTION" = ifup ] || [ "$ACTION" = ifupdate ] || exit 0
[ "$INTERFACE" = lan ] || exit 0

# Get LAN IP and calculate subnet (assumes /24; adjust if needed)
LAN_IP=$(uci -q get network.lan.ipaddr)
[ -z "$LAN_IP" ] && exit 1

# Simple /24 assumption (common); for full CIDR use ipcalc or awk
SUBNET="${LAN_IP%.*}.0/24"

cat > /etc/nftables.d/azizi_netspeed.nft <<EOF
table inet azizi_netspeed_counters {
    chain my_upload {
        type filter hook postrouting priority filter - 5; policy accept;
        ip daddr $SUBNET return
        ip saddr $SUBNET update @up_per_ip { ip saddr counter }
    }

    chain my_download {
        type filter hook prerouting priority filter - 5; policy accept;
        ip saddr $SUBNET return
        ip daddr $SUBNET update @down_per_ip { ip daddr counter }
    }

    set up_per_ip {
        type ipv4_addr
        flags dynamic, timeout
        timeout 5m
        gc-interval 1m
        counter
    }

    set down_per_ip {
        type ipv4_addr
        flags dynamic, timeout
        timeout 5m
        gc-interval 1m
        counter
    }
}
EOF

# Apply immediately
nft -f /etc/nftables.d/azizi_netspeed.nft 2>/dev/null || true