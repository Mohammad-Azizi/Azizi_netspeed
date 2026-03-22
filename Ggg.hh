set up_per_ip {
    type ipv4_addr
    flags dynamic, timeout
    timeout 24h
    counter
}

set down_per_ip {
    type ipv4_addr
    flags dynamic, timeout
    timeout 24h
    counter
}

chain azizi_monitor {
    type filter hook forward priority filter - 1; policy accept;

    # 1. Ignore Broadcast and Multicast traffic (noise that resets timers)
    fib daddr type { broadcast, multicast } return
    fib saddr type { broadcast, multicast } return

   
    iifname "br-lan" ct state established update @up_per_ip { ip saddr counter }
    oifname "br-lan" ct state established update @down_per_ip { ip daddr counter }
}
