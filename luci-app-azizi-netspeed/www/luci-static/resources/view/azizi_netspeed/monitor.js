'use strict';
'use ui';

var getHostHints = L.rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { "": {} } });

var RC = {};

return L.view.extend({
    handleSaveApply: null,
    handleSave: null,
    handleReset: null,

    title: _('Realtime Network Monitor'),

    speed_label: function(b) {
        var bits = (b || 0) * 8;
        if (bits <= 0) return '0.00 kb/s';
        if (bits >= 1000000) return (bits / 1000000).toFixed(2) + ' mb/s';
        return (bits / 1000).toFixed(2) + ' kb/s';
    },

    bytes_label: function(b) {
        var val = b || 0;
        if (val >= 1073741824) return (val / 1073741824).toFixed(2) + ' GB';
        if (val >= 1048576) return (val / 1048576).toFixed(2) + ' MB';
        return (val / 1024).toFixed(2) + ' KB';
    },

    usage_label: function(bytes, pkts) {
        return this.bytes_label(bytes) + ' | ' + (pkts || 0).toLocaleString() + ' pkts';
    },

    formatDiff: function(diff) {
        if (diff < 10) return null; // online
        if (diff < 60) return Math.floor(diff) + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    },

    load: function() {
        return Promise.all([
            getHostHints(),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed_yu/up_per_ip.json'), '{}'),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed_yu/down_per_ip.json'), '{}'),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed_yu/hosts.json'), '{}')
        ]);
    },

    processYesterday: function(hints, upJsonStr, downJsonStr, savedHostsStr) {
        var self = this;
        var upData = {}, downData = {}, savedHosts = {};
        try { upData = typeof upJsonStr === 'string' && upJsonStr.trim() ? JSON.parse(upJsonStr) : {}; } catch(e) {}
        try { downData = typeof downJsonStr === 'string' && downJsonStr.trim() ? JSON.parse(downJsonStr) : {}; } catch(e) {}
        try { savedHosts = typeof savedHostsStr === 'string' && savedHostsStr.trim() ? JSON.parse(savedHostsStr) : {}; } catch(e) {}

        var RA = {}, tDLB = 0, tULB = 0, tPKT_DL = 0, tPKT_UL = 0;

        var findInfo = function(ip) {
            var host = null;

            if (hints) {
                Object.keys(hints).forEach(function(mac) {
                    var h = hints[mac];
                    if (h.ipaddrs && h.ipaddrs.includes(ip)) host = { name: h.name || ip, mac: mac };
                });
            }

            if ((!host || host.name === ip) && savedHosts[ip]) {
                var s = savedHosts[ip];
                host = {
                    name: s.name || ip,
                    mac: s.mac || (host ? host.mac : '\u2014')
                };
            }

            return {
                name: (host && host.name) ? host.name : ip,
                mac: (host && host.mac) ? host.mac : '\u2014'
            };
        };

                var process = function(json, type) {
            var set = (json.nftables || []).find(function(i) { return i.set; });
            if (!set || !set.set || !set.set.elem) return;
            set.set.elem.forEach(function(item) {
                var e = item.elem, ip = e.val;
                if (!RA[ip]) {
                    var info = findInfo(ip);
                    RA[ip] = {
                        dl: 0, ul: 0,
                        t_dl: 0, t_ul: 0,
                        p_dl: 0, p_ul: 0,
                        expires: 0,  // Start at 0
                        name: info.name,
                        mac: info.mac
                    };
                }
                var bytes = (e.counter && e.counter.bytes) ? e.counter.bytes : 0;
                var pkts = (e.counter && e.counter.packets) ? e.counter.packets : 0;
                var rate = (RC[type + ip] && bytes >= RC[type + ip]) ? (bytes - RC[type + ip]) / 3 : 0;
                RC[type + ip] = bytes;

                // THE FIX: ONLY update the timeout if it's an UPLOAD ('u') packet.
                // Ignore download expirations completely to filter out internet noise.
                if (type === 'u' && e.expires) {
                    RA[ip].expires = Math.max(RA[ip].expires, e.expires);
                }

                if (type === 'u') { RA[ip].ul = rate; RA[ip].t_ul = bytes; RA[ip].p_ul = pkts; }
                else { RA[ip].dl = rate; RA[ip].t_dl = bytes; RA[ip].p_dl = pkts; }
            });
        };

        process(upData, 'u');
        process(downData, 'd');

        var rows = [];
        Object.keys(RA).sort(function(a, b) {
            return (RA[b].t_dl + RA[b].t_ul) - (RA[a].t_dl + RA[a].t_ul);
        }).forEach(function(ip) {
            var d = RA[ip];
            tDLB += d.t_dl; tULB += d.t_ul;
            tPKT_DL += d.p_dl; tPKT_UL += d.p_ul;

            rows.push(E('tr', {}, [
                E('td', {}, [
                    E('div', {}, E('span', { 'class': 'hostname' }, d.name)),
                    E('span', { 'class': 'info-sub' }, ip + ' | ' + d.mac)
                ]),
                E('td', {}, [
                    E('span', { 'style': 'color:#4caf50' }, '\u2193 ' + self.bytes_label(d.t_dl)),
                    E('div', { 'class': 'info-sub' }, d.p_dl.toLocaleString() + ' pkts')
                ]),
                E('td', {}, [
                    E('span', { 'style': 'color:#ff9800' }, '\u2191 ' + self.bytes_label(d.t_ul)),
                    E('div', { 'class': 'info-sub' }, d.p_ul.toLocaleString() + ' pkts')
                ]),
                E('td', {}, [
                    E('strong', { 'style': 'color:#ffd700' }, self.bytes_label(d.t_dl + d.t_ul)),
                    E('div', { 'class': 'info-sub' }, (d.p_dl + d.p_ul).toLocaleString() + ' pkts')
                ])
            ]));
        });

        if (rows.length === 0) {
            rows.push(E('tr', {}, E('td', { 'colspan': '4', 'style': 'text-align:center; padding: 30px; color: var(--az-text-muted);' },
                _('No data available for yesterday.'))));
        }

        return { totalDown: tDLB, totalUp: tULB, totalCombined: tDLB + tULB, pDown: tPKT_DL, pUp: tPKT_UL, rows: rows };
    },

    render: function(res) {
        var self = this;
        var hints = res[0];
        var yData = this.processYesterday(hints, res[1], res[2], res[3]);

        var yd = new Date();
        yd.setDate(yd.getDate() - 1);
        var yDateStr = yd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

        var yesterdayTableBody = E('div', { 'class': 'y-body', 'id': 'y_table_body', 'style': 'display: none;' }, [
            E('div', { 'class': 'table-box', 'style': 'border: none; border-radius: 0 0 10px 10px; margin: 0;' }, [
                E('table', { 'class': 'device-table' }, [
                    E('thead', {}, E('tr', {}, [
                        E('th', {}, _('Device')), E('th', {}, _('Download')), E('th', {}, _('Upload')), E('th', {}, _('Total Used'))
                    ])),
                    E('tbody', {}, yData.rows)
                ])
            ])
        ]);

        var m = E('div', { 'class': 'azizi-container' }, [
            E('style', {}, [
                ':root {',
                '  --az-bg-card: #ffffff; --az-border: #e0e0e0; --az-text-main: #222;',
                '  --az-text-muted: #888; --az-table-header: #f5f5f5; --az-table-hover: #fafafa;',
                '  --az-y-header: linear-gradient(90deg, #f8f8f8, #f0f0f0);',
                '  --az-badge-bg: rgba(0,0,0,0.03); --az-help-bg: #e8e8e8; --az-help-border: #ccc;',
                '  --az-sysinfo-bg: #f5f5f5; --az-footer-bg: #f5f5f5; --az-footer-border: #ddd;',
                '}',
                '@media (prefers-color-scheme: dark) {',
                '  :root {',
                '    --az-bg-card: #1a1a1a; --az-border: #333; --az-text-main: #eee;',
                '    --az-text-muted: #888; --az-table-header: #2D2D2D; --az-table-hover: #1f1f1f;',
                '    --az-y-header: linear-gradient(90deg, #181818, #111);',
                '    --az-badge-bg: rgba(255,255,255,0.03); --az-help-bg: #2d2d2d; --az-help-border: #444;',
                '    --az-sysinfo-bg: #1a1a1a; --az-footer-bg: #1a1a1a; --az-footer-border: #333;',
                '  }',
                '}',
                '',
                '.azizi-container { max-width: 1200px; margin: 0 auto; padding: 10px; color: var(--az-text-main); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
                '',
                '.top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-wrap: wrap; gap: 12px; }',
                '.page-header { display: flex; align-items: center; gap: 10px; }',
                '.page-title { margin: 0; font-weight: 600; font-size: 1.6rem; color: var(--az-text-main); }',
                '.help-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--az-help-bg); border: 1px solid var(--az-help-border); color: var(--az-text-muted); font-size: 12px; font-weight: bold; cursor: pointer; transition: all 0.2s; }',
                '.help-btn:hover { background: #ffd700; color: #000; border-color: #ffd700; transform: scale(1.1); box-shadow: 0 0 8px rgba(255,215,0,0.3); }',
                '.sys-info-box { font-size: 0.82rem; color: var(--az-text-muted); font-family: monospace; background: var(--az-sysinfo-bg); padding: 6px 16px; border-radius: 8px; border: 1px solid var(--az-border); }',
                '',
                '.summary-box { display: flex; gap: 14px; margin-bottom: 25px; flex-wrap: wrap; }',
                '.card { flex: 1; min-width: 200px; background: var(--az-bg-card); border: 1px solid var(--az-border); border-radius: 12px; padding: 18px; text-align: center; transition: all 0.3s; }',
                '.card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); }',
                '.card h4 { color: var(--az-text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; }',
                '.card .val { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; display: block; }',
                '.card .sub { color: var(--az-text-muted); font-size: 0.76rem; }',
                '',
                '.table-box { background: var(--az-bg-card); border: 1px solid var(--az-border); border-radius: 12px; overflow-x: auto; margin-bottom: 25px; }',
                '.device-table { width: 100%; border-collapse: collapse; min-width: 650px; }',
                '.device-table th { background: var(--az-table-header); padding: 12px 14px; text-align: left; color: var(--az-text-muted); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--az-border); }',
                '.device-table td { padding: 12px 14px; border-bottom: 1px solid var(--az-border); vertical-align: middle; }',
                '.device-table tr:last-child td { border-bottom: none; }',
                '.device-table tr:hover td { background: var(--az-table-hover); }',
                '',
                '.hostname { color: var(--az-text-main); font-weight: 600; font-size: 0.95rem; }',
                '.info-sub { color: var(--az-text-muted); font-size: 0.72rem; display: block; font-family: monospace; margin-top: 2px; }',
                '',
                '.tag { font-size: 0.62rem; padding: 2px 7px; border-radius: 4px; font-weight: 600; display: inline-block; margin-left: 8px; vertical-align: text-bottom; }',
                '.tag.online { background: rgba(76,175,80,0.15); color: #4caf50; border: 1px solid rgba(76,175,80,0.25); }',
                '.tag.offline { background: var(--az-badge-bg); color: var(--az-text-muted); border: 1px solid var(--az-border); }',
                '',
                '.y-wrapper { background: var(--az-bg-card); border: 1px solid var(--az-border); border-radius: 12px; margin-bottom: 30px; overflow: hidden; transition: all 0.3s; }',
                '.y-header { padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--az-y-header); transition: 0.2s; user-select: none; }',
                '.y-header:hover { opacity: 0.85; }',
                '.y-title-area { display: flex; flex-direction: column; gap: 8px; }',
                '.y-title { margin: 0; color: var(--az-text-main); font-size: 1rem; font-weight: 600; }',
                '.y-date { color: var(--az-text-muted); font-size: 0.78rem; font-weight: normal; }',
                '.y-badges { display: flex; gap: 8px; flex-wrap: wrap; }',
                '.y-badge { padding: 4px 10px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; background: var(--az-badge-bg); border: 1px solid var(--az-border); }',
                '.y-badge.tot { color: #ffd700; border-color: rgba(255,215,0,0.25); }',
                '.y-badge.dl { color: #4caf50; border-color: rgba(76,175,80,0.25); }',
                '.y-badge.ul { color: #ff9800; border-color: rgba(255,152,0,0.25); }',
                '.y-arrow { font-size: 0.85rem; color: var(--az-text-muted); transition: transform 0.3s ease; padding: 5px; }',
                '.y-wrapper.open .y-arrow { transform: rotate(180deg); }',
                '.y-wrapper.open { border-color: var(--az-text-muted); }',
                '',
                '.az-footer { margin-top: 30px; padding: 20px; border-top: 1px solid var(--az-footer-border); text-align: center; font-size: 0.82rem; color: var(--az-text-muted); line-height: 1.8; }',
                '.gh-btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 20px; border-radius: 50px; background: var(--az-footer-bg); border: 1px solid var(--az-footer-border); color: var(--az-text-muted) !important; text-decoration: none !important; font-size: 0.82rem; transition: all 0.3s; margin-top: 12px; }',
                '.gh-btn:hover { border-color: #4caf50; color: #4caf50 !important; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }',
                '.gh-btn svg { fill: currentColor; }',
                '',
                '@media screen and (max-width: 600px) {',
                '  .summary-box { flex-direction: column; }',
                '  .card { min-width: 100%; }',
                '  .top-bar { flex-direction: column; align-items: flex-start; }',
                '  .y-header { flex-direction: column; align-items: flex-start; gap: 10px; }',
                '  .y-arrow { position: absolute; right: 15px; top: 18px; }',
                '  .y-wrapper { position: relative; }',
                '}'
            ].join('\n')),

            E('div', { 'class': 'top-bar' }, [
                E('div', { 'class': 'page-header' }, [
                    E('h2', { 'class': 'page-title' }, this.title),
                    E('div', {
                        'class': 'help-btn',
                        'title': _('Information'),
                        'click': function() {
                            alert(
                                _('How Azizi NetSpeed Works:') + '\n\n' +
                                _('This page monitors real-time network usage per device.') + '\n\n' +
                                _('Every night at 11:59 PM, a scheduled task saves the current usage to the "Yesterday" panel and resets all counters to zero.') + '\n\n' +
                                _('To change the reset time, go to System \u2192 Scheduled Tasks.')
                            );
                        }
                    }, '?')
                ]),
                E('span', { 'class': 'sys-info-box', 'id': 'sys_time_el' }, '...')
            ]),

            E('div', { 'id': 'summary_area', 'class': 'summary-box' }, [
                this.renderCard('Total Load', '0.00 kb/s', '0 KB | 0 pkts', '#ffd700'),
                this.renderCard('Download', '\u2193 0.00 kb/s', '0 KB | 0 pkts', '#4caf50'),
                this.renderCard('Upload', '\u2191 0.00 kb/s', '0 KB | 0 pkts', '#ff9800')
            ]),

            E('div', { 'class': 'table-box' }, [
                E('table', { 'class': 'device-table' }, [
                    E('thead', {}, E('tr', {}, [
                        E('th', {}, _('Device & Status')),
                        E('th', {}, _('Download')),
                        E('th', {}, _('Upload')),
                        E('th', {}, _('Total'))
                    ])),
                    E('tbody', { 'id': 'device_body' })
                ])
            ]),

            E('div', { 'class': 'y-wrapper', 'id': 'y_wrapper' }, [
                E('div', {
                    'class': 'y-header',
                    'click': function() {
                        var wrap = document.getElementById('y_wrapper');
                        var body = document.getElementById('y_table_body');
                        if (wrap.classList.contains('open')) {
                            body.style.display = 'none';
                            wrap.classList.remove('open');
                        } else {
                            body.style.display = 'block';
                            wrap.classList.add('open');
                        }
                    }
                }, [
                    E('div', { 'class': 'y-title-area' }, [
                        E('h3', { 'class': 'y-title' }, [
                            _("Yesterday's Total Usage"),
                            ' ',
                            E('span', { 'class': 'y-date' }, '(' + yDateStr + ')')
                        ]),
                        E('div', { 'class': 'y-badges' }, [
                            E('span', { 'class': 'y-badge tot' }, 'Total: ' + self.usage_label(yData.totalCombined, yData.pDown + yData.pUp)),
                            E('span', { 'class': 'y-badge dl' }, '\u2193 ' + self.usage_label(yData.totalDown, yData.pDown)),
                            E('span', { 'class': 'y-badge ul' }, '\u2191 ' + self.usage_label(yData.totalUp, yData.pUp))
                        ])
                    ]),
                    E('div', { 'class': 'y-arrow' }, '\u25BC')
                ]),
                yesterdayTableBody
            ]),

                                    E('div', { 
    'style': 'margin-top:40px; padding:20px; border-top:1px solid #333; text-align:center; font-size:0.85rem; color:#777; line-height:1.6;'
}, [
    E('div', {}, [
        E('strong', { 'style': 'color:#eee' }, 'Azizi_NetSpeed'),
        ' project'
    ]),
    
    E('div', {}, [
        'Developed by ',
        E('span', { 'style': 'color:#ffd700; font-weight:bold;' }, 'Mohammad Azizi')
    ]),

    E('a', { 
        'href': 'https://github.com/Mohammad-Azizi/Azizi_netspeed',
        'target': '_blank',
        'style': 'color:#4caf50; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; margin-top:12px; border:1px solid #444; padding:6px 16px; border-radius:20px; background:#222; gap:8px;'
    }, [
        E('img', {
            'src': L.resource('view/azizi_netspeed/icons/github.svg'),
            'width': 16, // Reduced size to match text
            'height': 16,
            'style': 'filter: invert(58%) sepia(13%) saturate(1200%) hue-rotate(76deg) brightness(95%) contrast(80%);', 
            'class': 'middle'
        }),
        _('Follow on GitHub')
    ])
])
        ]);

        // Added hosts.json to the polling loop so live data also uses it as a fallback
        L.Poll.add(L.bind(function() {
            return Promise.all([
                getHostHints(),
                L.resolveDefault(L.fs.exec('/usr/sbin/nft', ['-j', 'list', 'set', 'inet', 'fw4', 'up_per_ip']), {}),
                L.resolveDefault(L.fs.exec('/usr/sbin/nft', ['-j', 'list', 'set', 'inet', 'fw4', 'down_per_ip']), {}),
                L.resolveDefault(L.fs.exec('/bin/date', ['+%Y-%m-%d %H:%M:%S']), {}),
                L.resolveDefault(L.fs.read('/root/azizi_netspeed_yu/hosts.json'), '{}')
            ]).then(L.bind(function(r) {
                this.updateUI(r[0], r[1], r[2], r[3], r[4]);
            }, this));
        }, this), 3);

        return m;
    },

    updateUI: function(hints, upRes, downRes, dateRes, savedHostsStr) {
        var self = this;

        var el = document.getElementById('sys_time_el');
        if (el) {
            el.innerText = (dateRes && dateRes.stdout) ? dateRes.stdout.trim() : '...';
        }

        var upData = {}, downData = {}, savedHosts = {};
        try { upData = typeof upRes.stdout === 'string' ? JSON.parse(upRes.stdout) : {}; } catch(e) {}
        try { downData = typeof downRes.stdout === 'string' ? JSON.parse(downRes.stdout) : {}; } catch(e) {}
        // Parse the hosts file string passed from the poll loop
        try { savedHosts = typeof savedHostsStr === 'string' && savedHostsStr.trim() ? JSON.parse(savedHostsStr) : {}; } catch(e) {}

        var RA = {}, tDL = 0, tUL = 0, tDLB = 0, tULB = 0, tPKT_DL = 0, tPKT_UL = 0;

        var findInfo = function(ip) {
            var host = null;

            // Check current active devices
            if (hints) {
                Object.keys(hints).forEach(function(mac) {
                    var h = hints[mac];
                    if (h.ipaddrs && h.ipaddrs.includes(ip)) host = { name: h.name || ip, mac: mac };
                });
            }

            // Fallback to hosts.json if device disconnected
            if ((!host || host.name === ip) && savedHosts[ip]) {
                var s = savedHosts[ip];
                host = {
                    name: s.name || ip,
                    mac: s.mac || (host ? host.mac : '\u2014')
                };
            }

            return { name: (host && host.name) ? host.name : ip, mac: (host && host.mac) ? host.mac : 'Unknown MAC' };
        };

        var process = function(json, type) {
            var set = (json.nftables || []).find(function(i) { return i.set; });
            if (!set || !set.set || !set.set.elem) return;
            set.set.elem.forEach(function(item) {
                var e = item.elem, ip = e.val;
                if (!RA[ip]) {
                    var info = findInfo(ip);
                    RA[ip] = {
                        dl: 0, ul: 0,
                        t_dl: 0, t_ul: 0,
                        p_dl: 0, p_ul: 0,
                        expires: 0, // Fix: start at 0
                        name: info.name,
                        mac: info.mac
                    };
                }
                var bytes = (e.counter && e.counter.bytes) ? e.counter.bytes : 0;
                var pkts = (e.counter && e.counter.packets) ? e.counter.packets : 0;
                var rate = (RC[type + ip] && bytes >= RC[type + ip]) ? (bytes - RC[type + ip]) / 3 : 0;
                RC[type + ip] = bytes;

                // Fix: keep the HIGHEST expires value (closest to 86400 = most recently active)
                if (e.expires) {
                    RA[ip].expires = Math.max(RA[ip].expires, e.expires);
                }

                if (type === 'u') { RA[ip].ul = rate; RA[ip].t_ul = bytes; RA[ip].p_ul = pkts; }
                else { RA[ip].dl = rate; RA[ip].t_dl = bytes; RA[ip].p_dl = pkts; }
            });
        };

        process(upData, 'u');
        process(downData, 'd');

        var rows = [];
        Object.keys(RA).sort(function(a, b) {
            return (RA[b].dl + RA[b].ul) - (RA[a].dl + RA[a].ul);
        }).forEach(function(ip) {
            var d = RA[ip];
            tDL += d.dl; tUL += d.ul;
            tDLB += d.t_dl; tULB += d.t_ul;
            tPKT_DL += d.p_dl; tPKT_UL += d.p_ul;

            // Timeout subtraction (86400 is 1 day in seconds).
            var diff = 86400 - d.expires;
            var agoText = self.formatDiff(diff);
            var statusTag = !agoText
                ? E('span', { 'class': 'tag online' }, _('Online'))
                : E('span', { 'class': 'tag offline' }, agoText);

            rows.push(E('tr', {}, [
                E('td', {}, [
                    E('div', {}, [E('span', { 'class': 'hostname' }, d.name), statusTag]),
                    E('span', { 'class': 'info-sub' }, ip + ' | ' + d.mac)
                ]),
                E('td', {}, [
                    E('span', { 'style': 'color:#4caf50' }, '\u2193 ' + self.speed_label(d.dl)),
                    E('div', { 'class': 'info-sub' }, self.usage_label(d.t_dl, d.p_dl))
                ]),
                E('td', {}, [
                    E('span', { 'style': 'color:#ff9800' }, '\u2191 ' + self.speed_label(d.ul)),
                    E('div', { 'class': 'info-sub' }, self.usage_label(d.t_ul, d.p_ul))
                ]),
                E('td', {}, [
                    E('strong', { 'style': 'color:#ffd700' }, self.speed_label(d.dl + d.ul)),
                    E('div', { 'class': 'info-sub' }, self.usage_label(d.t_dl + d.t_ul, d.p_dl + d.p_ul))
                ])
            ]));
        });

        L.dom.content(document.getElementById('device_body'), rows);
        L.dom.content(document.getElementById('summary_area'), [
            self.renderCard('Total Network Load', self.speed_label(tDL + tUL), self.usage_label(tDLB + tULB, tPKT_DL + tPKT_UL), '#ffd700'),
            self.renderCard('Download', '\u2193 ' + self.speed_label(tDL), self.usage_label(tDLB, tPKT_DL), '#4caf50'),
            self.renderCard('Upload', '\u2191 ' + self.speed_label(tUL), self.usage_label(tULB, tPKT_UL), '#ff9800')
        ]);
    },

    renderCard: function(title, val, usage, color) {
        return E('div', { 'class': 'card', 'style': 'border-top: 3px solid ' + color }, [
            E('h4', {}, _(title)),
            E('span', { 'class': 'val', 'style': 'color:' + color }, val),
            usage ? E('span', { 'class': 'sub' }, usage) : ''
        ]);
    }
});