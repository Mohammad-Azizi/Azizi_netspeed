#!/bin/sh

LIMITS_FILE="/root/azizi_netspeed/bwlimit/limits.json"

# --- 1. BOOT PERSISTENCE (rc.local) ---
# Automatically ensure this script runs on router startup
if [ -f "/etc/rc.local" ] && ! grep -q "apply_limits.sh" /etc/rc.local; then
    sed -i '/^exit 0/i /root/azizi_netspeed/bwlimit/apply_limits.sh force\n' /etc/rc.local
fi

# --- 2. DYNAMIC GLOBAL CONFIGURATION ---
LAN_IF=$(jsonfilter -i "$LIMITS_FILE" -e "@['__global_settings'].lan_if" 2>/dev/null)
[ -z "$LAN_IF" ] && LAN_IF="br-lan"

WAN_IF=$(jsonfilter -i "$LIMITS_FILE" -e "@['__global_settings'].wan_if" 2>/dev/null)
[ -z "$WAN_IF" ] && WAN_IF="eth0.2"

MAX_DL_KBIT=$(jsonfilter -i "$LIMITS_FILE" -e "@['__global_settings'].max_dl" 2>/dev/null)
[ -z "$MAX_DL_KBIT" ] && MAX_DL_KBIT=1000000

MAX_UL_KBIT=$(jsonfilter -i "$LIMITS_FILE" -e "@['__global_settings'].max_ul" 2>/dev/null)
[ -z "$MAX_UL_KBIT" ] && MAX_UL_KBIT=1000000

# STATE TRACKING
STATE_FILE="/tmp/qos_last_state"
CURRENT_STATE="${MAX_DL_KBIT}_${MAX_UL_KBIT}_${WAN_IF}_${LAN_IF}"

CURRENT_TIME=$(date +%H%M)
CURRENT_DAY=$(date +%w)

# --- 3. CRON JOB MANAGEMENT ---
CRON_FILE="/etc/crontabs/root"
CRON_CMD="* * * * * /root/azizi_netspeed/bwlimit/apply_limits.sh cron"

HAS_SCHED=$(grep -o '"sched": true' "$LIMITS_FILE" 2>/dev/null)
if [ -n "$HAS_SCHED" ]; then
    if ! grep -Fq "$CRON_CMD" "$CRON_FILE" 2>/dev/null; then
        echo "$CRON_CMD" >> "$CRON_FILE"
        /etc/init.d/cron restart
    fi
else
    if grep -Fq "$CRON_CMD" "$CRON_FILE" 2>/dev/null; then
        sed -i "\|${CRON_CMD}|d" "$CRON_FILE"
        /etc/init.d/cron restart
    fi
fi

# --- 4. CALCULATE CURRENT ACTIVE STATE ---
TARGETS=$(awk -F'"' '/^[ \t]*"[0-9]/ {print $2}' "$LIMITS_FILE")
ACTIVE_TARGETS=""

for TARGET in $TARGETS; do
    SCHED=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].sched" 2>/dev/null)
    DL=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].dl" 2>/dev/null)
    UL=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].ul" 2>/dev/null)
    PRIO=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].prio" 2>/dev/null)
    PING=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].ping" 2>/dev/null)

    # Schedule Logic
    if [ "$SCHED" = "true" ] || [ "$SCHED" = "1" ]; then
        START_TIME=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].start_time" 2>/dev/null | tr -d ':')
        END_TIME=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].end_time" 2>/dev/null | tr -d ':')
        DAYS=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].days" 2>/dev/null)

        if ! echo "$DAYS" | grep -q "$CURRENT_DAY"; then continue; fi

        if [ "$START_TIME" -le "$END_TIME" ]; then
            if [ "$CURRENT_TIME" -lt "$START_TIME" ] || [ "$CURRENT_TIME" -gt "$END_TIME" ]; then continue; fi
        else
            if [ "$CURRENT_TIME" -lt "$START_TIME" ] && [ "$CURRENT_TIME" -gt "$END_TIME" ]; then continue; fi
        fi
    fi

    ACTIVE_TARGETS="$ACTIVE_TARGETS $TARGET"
    CURRENT_STATE="${CURRENT_STATE}|${TARGET}_${DL}_${UL}_${PRIO}_${PING}"
done

LAST_STATE=$(cat "$STATE_FILE" 2>/dev/null)
if [ "$CURRENT_STATE" = "$LAST_STATE" ] && [ "$1" != "force" ]; then
    exit 0
fi
echo "$CURRENT_STATE" > "$STATE_FILE"

# --- 5. RESET TRAFFIC CONTROL ---
for IF in $LAN_IF $WAN_IF; do tc qdisc del dev $IF root 2>/dev/null; done
nft delete table inet bwlimit 2>/dev/null

if [ -z "$ACTIVE_TARGETS" ]; then exit 0; fi

# --- 6. BASE SETUP ---
for IF in $LAN_IF $WAN_IF; do
    tc qdisc add dev $IF root handle 1: htb default 99
    tc class add dev $IF parent 1: classid 1:99 htb rate ${MAX_DL_KBIT}kbit ceil ${MAX_DL_KBIT}kbit
done
tc class change dev $WAN_IF parent 1: classid 1:99 htb rate ${MAX_UL_KBIT}kbit ceil ${MAX_UL_KBIT}kbit

nft add table inet bwlimit
nft add chain inet bwlimit forward { type filter hook forward priority mangle \; }

MARK=10

# --- 7. APPLY ACTIVE RULES ---
for TARGET in $ACTIVE_TARGETS; do
    DL=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].dl" 2>/dev/null)
    UL=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].ul" 2>/dev/null)
    TYPE=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].type" 2>/dev/null)
    PRIO=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].prio" 2>/dev/null)
    PING=$(jsonfilter -i "$LIMITS_FILE" -e "@['$TARGET'].ping" 2>/dev/null)

    TC_PRIO=3; [ "$PRIO" = "high" ] && TC_PRIO=1; [ "$PRIO" = "low" ] && TC_PRIO=5
    CAKE_ARGS="besteffort"
    if [ "$PING" = "true" ] || [ "$PING" = "1" ]; then CAKE_ARGS="diffserv4 ack-filter"; fi

    if [ -n "$DL" ] && [ "$DL" -gt 0 ]; then
        MARK=$((MARK + 1))
        CEIL_DL=$DL; [ "$TYPE" = "share" ] && CEIL_DL=$MAX_DL_KBIT
        tc class add dev $LAN_IF parent 1: classid 1:$MARK htb rate ${DL}kbit ceil ${CEIL_DL}kbit prio $TC_PRIO
        tc qdisc add dev $LAN_IF parent 1:$MARK handle $MARK: cake $CAKE_ARGS nat dual-dsthost
        tc filter add dev $LAN_IF protocol ip parent 1: prio 1 handle $MARK fw flowid 1:$MARK
        nft add rule inet bwlimit forward ip daddr $TARGET meta mark set $MARK
    fi

    if [ -n "$UL" ] && [ "$UL" -gt 0 ]; then
        MARK=$((MARK + 1))
        CEIL_UL=$UL; [ "$TYPE" = "share" ] && CEIL_UL=$MAX_UL_KBIT
        tc class add dev $WAN_IF parent 1: classid 1:$MARK htb rate ${UL}kbit ceil ${CEIL_UL}kbit prio $TC_PRIO
        tc qdisc add dev $WAN_IF parent 1:$MARK handle $MARK: cake $CAKE_ARGS nat dual-srchost
        tc filter add dev $WAN_IF protocol ip parent 1: prio 1 handle $MARK fw flowid 1:$MARK
        nft add rule inet bwlimit forward ip saddr $TARGET meta mark set $MARK
    fi

    if { [ -z "$DL" ] || [ "$DL" -eq 0 ]; } && { [ "$PRIO" != "normal" ] || [ "$PING" = "true" ]; }; then
        MARK=$((MARK + 1))
        tc class add dev $LAN_IF parent 1: classid 1:$MARK htb rate 100mbit ceil ${MAX_DL_KBIT}kbit prio $TC_PRIO
        tc qdisc add dev $LAN_IF parent 1:$MARK handle $MARK: cake $CAKE_ARGS nat dual-dsthost
        tc filter add dev $LAN_IF protocol ip parent 1: prio 1 handle $MARK fw flowid 1:$MARK
        nft add rule inet bwlimit forward ip daddr $TARGET meta mark set $MARK
        MARK=$((MARK + 1))
        tc class add dev $WAN_IF parent 1: classid 1:$MARK htb rate 100mbit ceil ${MAX_UL_KBIT}kbit prio $TC_PRIO
        tc qdisc add dev $WAN_IF parent 1:$MARK handle $MARK: cake $CAKE_ARGS nat dual-srchost
        tc filter add dev $WAN_IF protocol ip parent 1: prio 1 handle $MARK fw flowid 1:$MARK
        nft add rule inet bwlimit forward ip saddr $TARGET meta mark set $MARK
    fi
done
exit 0