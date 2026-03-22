#!/bin/sh

DIR="/root/azizi_netspeed_yu"
UP_FILE="$DIR/up_per_ip.json"
DOWN_FILE="$DIR/down_per_ip.json"
HOSTS_FILE="$DIR/hosts.json"

mkdir -p "$DIR"

TMP_UP="${UP_FILE}.$$"
TMP_DOWN="${DOWN_FILE}.$$"
TMP_HOSTS="${HOSTS_FILE}.$$"

# Save nft data
nft -j list set inet fw4 up_per_ip > "$TMP_UP" 2>/dev/null
nft -j list set inet fw4 down_per_ip > "$TMP_DOWN" 2>/dev/null

# Save hostname mappings from DHCP leases
# Format: {"192.168.1.x":{"name":"Phone","mac":"AA:BB:CC:DD:EE:FF"}, ...}
if [ -f /tmp/dhcp.leases ]; then
    awk 'BEGIN{printf "{"}
        $4!="*" && $4!="" {
            if(n++) printf ",";
            printf "\"%s\":{\"name\":\"%s\",\"mac\":\"%s\"}", $3, $4, $2
        }
        END{printf "}"}' /tmp/dhcp.leases > "$TMP_HOSTS"
else
    echo '{}' > "$TMP_HOSTS"
fi

mv "$TMP_UP" "$UP_FILE"
mv "$TMP_DOWN" "$DOWN_FILE"
mv "$TMP_HOSTS" "$HOSTS_FILE"

# Reset counters
nft flush set inet fw4 up_per_ip 2>/dev/null
nft flush set inet fw4 down_per_ip 2>/dev/null

logger -t azizi_monitor "Saved bandwidth data and hostnames to $DIR"