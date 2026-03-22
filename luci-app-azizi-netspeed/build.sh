#!/bin/bash

# Configuration
PKG_NAME="luci-app-azizi-netspeed"
PKG_VER="2.0"
SRC_DIR="/sdcard/azizi_netspeed2"
TEMP_DIR="$HOME/ipk_temp2"

echo "Building $PKG_NAME v$PKG_VER ..."

# -----------------------------------------
# 1. Clean and prepare temp directory
# -----------------------------------------

echo "creating Temporary directories..."
rm -rf "$TEMP_DIR"

# Create ALL required directories EXPLICITLY (fixes your error!)
mkdir -p "$TEMP_DIR/CONTROL"
mkdir -p "$TEMP_DIR/etc/nftables.d/"
mkdir -p "$TEMP_DIR/root/"
mkdir -p "$TEMP_DIR/etc/crontabs/"
mkdir -p "$TEMP_DIR/usr/share/luci/menu.d"
mkdir -p "$TEMP_DIR/usr/share/rpcd/acl.d"
mkdir -p "$TEMP_DIR/www/luci-static/resources/view/azizi_netspeed"
mkdir -p "$TEMP_DIR/www/luci-static/resources/view/azizi_netspeed/icons/"


echo "Pasting files in directories"
#pasting files
cp "$SRC_DIR/www/luci-static/resources/view/azizi_netspeed/monitor.js" "$TEMP_DIR/www/luci-static/resources/view/azizi_netspeed/"

cp "$SRC_DIR/www/luci-static/resources/view/azizi_netspeed/icons/github.svg" "$TEMP_DIR/www/luci-static/resources/view/azizi_netspeed/icons/"

cp "$SRC_DIR/etc/nftables.d/azizi_monitor.nft" "$TEMP_DIR/etc/nftables.d/"

cp "$SRC_DIR/usr/share/rpcd/acl.d/luci-app-azizi-netspeed.json" "$TEMP_DIR/usr/share/rpcd/acl.d/"


cp "$SRC_DIR/usr/share/luci/menu.d/luci-app-azizi-netspeed.json" "$TEMP_DIR/usr/share/luci/menu.d/"



cp "$SRC_DIR/root/azizi_netspeed_save.sh" "$TEMP_DIR/root/"





# Calculate exact installed size in Kilobytes
SIZE=$(du -sk "$TEMP_DIR" | cut -f1)



echo "creating control file...."
cat <<EOF > "$TEMP_DIR/CONTROL/control"
Package: $PKG_NAME
Version: $PKG_VER
Title: Real-time Network Monitor (Azizi)
Section: luci
Category: Status
Priority: optional
Architecture: all
Installed-Size: $SIZE
Maintainer: Mohammad Azizi <mohammad.afg.contact@gmail.com>
Depends: libc, luci-base, nftables, rpcd
License: Apache-2.0
Source: https://github.com/mohammadazizi/luci-app-azizi-netspeed
Description: A lightweight real-time network speed and traffic monitor using nftables
EOF


echo "creating postinst file..."
cat <<'EOF' > "$TEMP_DIR/CONTROL/postinst"
#!/bin/sh
# Check if we are installing on a running system (not a build image)
if [ -z "$IPKG_INSTROOT" ]; then
    echo "Setting file permissions..."
    chmod 755 /root/azizi_netspeed_save.sh
    chmod 755 /etc/nftables.d/azizi_monitor.nft
    
    
    
    # SAFELY Inject cron job if it doesn't exist
    if ! grep -q "azizi_netspeed_save.sh" /etc/crontabs/root 2>/dev/null; then
        echo "59 23 * * * /root/azizi_netspeed_save.sh" >> /etc/crontabs/root
        /etc/init.d/cron restart
    fi
  
  /etc/init.d/firewall restart

fi
exit 0
EOF




echo "creating postrm file..."
cat <<'EOF' > "$TEMP_DIR/CONTROL/postrm"
#!/bin/sh
# postrm for azizi_netspeed

if [ -z "$IPKG_INSTROOT" ]; then
    echo "azizi_netspeed: cleaning up nftables counters..."

    # Flush and delete chain safely
    nft flush chain inet fw4 azizi_monitor 2>/dev/null
    nft delete chain inet fw4 azizi_monitor 2>/dev/null

    # Delete sets safely
    nft delete set inet fw4 up_per_ip 2>/dev/null
    nft delete set inet fw4 down_per_ip 2>/dev/null

    # Remove JSON logs
    rm -rf /root/azizi_netspeed_yu


    # SAFELY Remove our specific cron job without touching user's other jobs
    sed -i '/azizi_netspeed_save.sh/d' /etc/crontabs/root
    /etc/init.d/cron restart
    
    echo "azizi_netspeed cleanup complete."
fi

exit 0
EOF

# =============================================
# SET PERMISSIONS
# =============================================
chmod 755 "$TEMP_DIR/CONTROL/postinst"
chmod 755 "$TEMP_DIR/CONTROL/postrm"



find "$TEMP_DIR/usr" -type f -exec chmod 644 {} \;   # JSON/JS files
find "$TEMP_DIR/www"  -type f -exec chmod 644 {} \;
find "$TEMP_DIR"      -type d -exec chmod 755 {} +

# =============================================
# BUILD THE IPK
# =============================================
cd "$TEMP_DIR" || exit 1
tar --owner=0 --group=0 --numeric-owner -czf ../data.tar.gz --exclude=CONTROL .
cd CONTROL || exit 1
tar --owner=0 --group=0 --numeric-owner -czf ../../control.tar.gz .
cd ../.. || exit 1
echo "2.0" > debian-binary

IPK_PATH="$SRC_DIR/${PKG_NAME}_${PKG_VER}_all.ipk"
tar -czf "$IPK_PATH" debian-binary control.tar.gz data.tar.gz

echo "=== SUCCESS! Package created at: ==="
echo "$IPK_PATH"

# Cleanup
rm -rf "$TEMP_DIR" control.tar.gz data.tar.gz debian-binary