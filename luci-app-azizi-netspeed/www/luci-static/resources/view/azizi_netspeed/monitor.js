'use strict';
'use ui';

var getHostHints = L.rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { "": {} } });

var RC = {};

return L.view.extend({
    title: _('Realtime Network Monitor & QoS'),

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

    usage_label: function(bytes, pkts) { return this.bytes_label(bytes) + ' | ' + (pkts || 0).toLocaleString() + ' pkts'; },

    formatDiff: function(diff) {
        if (diff < 10) return null; 
        if (diff < 60) return Math.floor(diff) + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    },

    load: function() {
        return Promise.all([
            getHostHints(),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed/usage/up_per_ip.json'), '{}'),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed/usage/down_per_ip.json'), '{}'),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed/usage/hosts.json'), '{}'),
            L.resolveDefault(L.fs.read('/root/azizi_netspeed/bwlimit/limits.json'), '{}')
        ]);
    },

    processYesterday: function(hints, upJsonStr, downJsonStr, savedHostsStr) {
        var self = this;
        var upData = {}, downData = {}, savedHosts = {};
        try { upData = typeof upJsonStr === 'string' ? JSON.parse(upJsonStr) : {}; } catch(e) {}
        try { downData = typeof downJsonStr === 'string' ? JSON.parse(downJsonStr) : {}; } catch(e) {}
        try { savedHosts = typeof savedHostsStr === 'string' ? JSON.parse(savedHostsStr) : {}; } catch(e) {}

        var RA = {}, tDLB = 0, tULB = 0, tPKT_DL = 0, tPKT_UL = 0;

        var findInfo = function(ip) {
            var host = null;
            if (hints) Object.keys(hints).forEach(function(mac) {
                var h = hints[mac];
                if (h.ipaddrs && h.ipaddrs.includes(ip)) host = { name: h.name || ip, mac: mac };
            });
            if ((!host || host.name === ip) && savedHosts[ip]) { host = { name: savedHosts[ip].name || ip, mac: savedHosts[ip].mac || '\u2014' }; }
            return { name: (host && host.name) ? host.name : ip, mac: (host && host.mac) ? host.mac : '\u2014' };
        };

        var process = function(json, type) {
            var set = (json.nftables || []).find(function(i) { return i.set; });
            if (!set || !set.set || !set.set.elem) return;
            set.set.elem.forEach(function(item) {
                var e = item.elem, ip = e.val;
                if (!RA[ip]) RA[ip] = { dl:0, ul:0, t_dl:0, t_ul:0, p_dl:0, p_ul:0, name: findInfo(ip).name, mac: findInfo(ip).mac };
                var bytes = (e.counter && e.counter.bytes) ? e.counter.bytes : 0;
                var pkts = (e.counter && e.counter.packets) ? e.counter.packets : 0;
                if (type === 'u') { RA[ip].t_ul = bytes; RA[ip].p_ul = pkts; } else { RA[ip].t_dl = bytes; RA[ip].p_dl = pkts; }
            });
        };
        process(upData, 'u'); process(downData, 'd');

        var rows = [];
        Object.keys(RA).sort(function(a, b) { return (RA[b].t_dl + RA[b].t_ul) - (RA[a].t_dl + RA[a].t_ul); }).forEach(function(ip) {
            var d = RA[ip]; tDLB += d.t_dl; tULB += d.t_ul; tPKT_DL += d.p_dl; tPKT_UL += d.p_ul;
            rows.push(E('tr', {}, [
                E('td', {}, [ E('div', {}, E('span', { 'class': 'hostname' }, d.name)), E('span', { 'class': 'info-sub' }, ip + ' | ' + d.mac) ]),
                E('td', {}, [ E('span', { 'style': 'color:#4caf50' }, '\u2193 ' + self.bytes_label(d.t_dl)), E('div', { 'class': 'info-sub' }, d.p_dl.toLocaleString() + ' pkts') ]),
                E('td', {}, [ E('span', { 'style': 'color:#ff9800' }, '\u2191 ' + self.bytes_label(d.t_ul)), E('div', { 'class': 'info-sub' }, d.p_ul.toLocaleString() + ' pkts') ]),
                E('td', {}, [ E('strong', { 'style': 'color:#ffd700' }, self.bytes_label(d.t_dl + d.t_ul)), E('div', { 'class': 'info-sub' }, (d.p_dl + d.p_ul).toLocaleString() + ' pkts') ])
            ]));
        });
        if (rows.length === 0) rows.push(E('tr', {}, E('td', { 'colspan': '4', 'style': 'text-align:center; padding: 20px; color: var(--az-text-muted);' }, _('No data available for yesterday.'))));

        return { totalDown: tDLB, totalUp: tULB, totalCombined: tDLB + tULB, pDown: tPKT_DL, pUp: tPKT_UL, rows: rows };
    },

    showGlobalSettingsModal: function(globalSettings) {
        var self = this;
        var s = globalSettings || {};
        var maxDl = s.max_dl || 1000000;
        var maxUl = s.max_ul || 1000000;
        var lanIf = s.lan_if || 'br-lan';
        var wanIf = s.wan_if || 'eth0.2';

        var m = E('div', { 'class': 'cbi-map' }, [
            E('h3', {}, _('Global QoS Settings')),
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('LAN Interface')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 'type': 'text', 'id': 'g_lan_if', 'value': lanIf }),
                        E('div', { 'class': 'cbi-value-description' }, _('Usually br-lan. Needed for Download limits.'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('WAN Interface')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 'type': 'text', 'id': 'g_wan_if', 'value': wanIf }),
                        E('div', { 'class': 'cbi-value-description' }, _('E.g. eth0.2, pppoe-wan, etc. Needed for Upload limits.'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Max ISP Download (Kbps)')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 'type': 'number', 'id': 'g_max_dl', 'value': maxDl }),
                        E('div', { 'class': 'cbi-value-description' }, _('Total Internet Download Speed. Crucial for "Shared" bandwidth borrowing.'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Max ISP Upload (Kbps)')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 'type': 'number', 'id': 'g_max_ul', 'value': maxUl })
                    ])
                ])
            ]),
            E('div', { 'class': 'right' }, [
                E('button', { 'class': 'btn cbi-button cbi-button-remove', 'click': L.hideModal }, _('Cancel')), ' ',
                E('button', {
                    'class': 'btn cbi-button cbi-button-action important',
                    'click': function() {
                        var cDl = document.getElementById('g_max_dl').value;
                        var cUl = document.getElementById('g_max_ul').value;
                        var cLan = document.getElementById('g_lan_if').value.trim();
                        var cWan = document.getElementById('g_wan_if').value.trim();
                        self.saveGlobalSettings(cDl, cUl, cLan, cWan);
                    }
                }, _('Save Settings'))
            ])
        ]);
        L.showModal(_('Global Settings'), m);
    },

    saveGlobalSettings: function(dl, ul, lan, wan) {
        var self = this;
        L.resolveDefault(L.fs.read('/root/azizi_netspeed/bwlimit/limits.json'), '{}').then(function(res) {
            var limits = {};
            try { limits = JSON.parse(res); } catch(e) {}
            limits['__global_settings'] = { max_dl: parseInt(dl), max_ul: parseInt(ul), lan_if: lan, wan_if: wan };
            return L.fs.write('/root/azizi_netspeed/bwlimit/limits.json', JSON.stringify(limits, null, 2));
        }).then(function() {
            return L.resolveDefault(L.fs.exec('/bin/sh', ['/root/azizi_netspeed/bwlimit/apply_limits.sh', 'force']), {});
        }).then(function() {
            L.hideModal();
            L.ui.addNotification(null, E('p', _('Global Settings updated.')), 'info');
        }).catch(function(e) { L.hideModal(); });
    },

    showLimitModal: function(target, name, curLimits) {
        var self = this;
        var dlLimit = (curLimits && curLimits.dl) ? curLimits.dl : '';
        var ulLimit = (curLimits && curLimits.ul) ? curLimits.ul : '';
        var type = (curLimits && curLimits.type) ? curLimits.type : 'strict';
        var prio = (curLimits && curLimits.prio) ? curLimits.prio : 'normal';
        var ping = (curLimits && curLimits.ping) ? curLimits.ping : false;
        var sched = (curLimits && curLimits.sched) ? curLimits.sched : false;
        var st = (curLimits && curLimits.start_time) ? curLimits.start_time : '08:00';
        var et = (curLimits && curLimits.end_time) ? curLimits.end_time : '22:00';
        var days = (curLimits && curLimits.days) ? curLimits.days.split(',') : ['1','2','3','4','5']; 

        var isNew = !target;
        var title = isNew ? _('Create Custom QoS Rule') : _('Configure QoS for ') + (name || target);

        var daysHtml = [];
        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for(var i=0; i<7; i++) {
            daysHtml.push(E('label', { 'style': 'margin-right: 10px; font-size: 0.8rem;' }, [
                E('input', { 'type': 'checkbox', 'class': 'day-chk', 'value': i, 'checked': days.includes(i.toString()) ? 'checked' : null }),
                ' ' + dayNames[i]
            ]));
        }

        var m = E('div', { 'class': 'cbi-map' }, [
            E('h3', {}, title),
            E('div', { 'class': 'cbi-section' }, [
                isNew ? E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Target IP / Range')),
                    E('div', { 'class': 'cbi-value-field' }, [ E('input', { 'type': 'text', 'id': 'qos_target', 'placeholder': 'e.g. 192.168.1.50 or 192.168.1.100-192.168.1.150' }) ])
                ]) : '',
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Download Limit (Kbps)')),
                    E('div', { 'class': 'cbi-value-field' }, [ E('input', { 'type': 'number', 'id': 'dl_limit_input', 'value': dlLimit, 'placeholder': '0 = Unlimited' }) ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Upload Limit (Kbps)')),
                    E('div', { 'class': 'cbi-value-field' }, [ E('input', { 'type': 'number', 'id': 'ul_limit_input', 'value': ulLimit, 'placeholder': '0 = Unlimited' }) ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Limit Type')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('select', { 'id': 'limit_type' }, [
                            E('option', { 'value': 'strict', 'selected': type === 'strict' ? 'selected' : null }, _('Strict (DDC) - Hard cap at limit')),
                            E('option', { 'value': 'share', 'selected': type === 'share' ? 'selected' : null }, _('Shared - Can borrow extra if network is idle'))
                        ])
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Network Priority')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('select', { 'id': 'limit_prio' }, [
                            E('option', { 'value': 'high', 'selected': prio === 'high' ? 'selected' : null }, _('High (Prioritize over others)')),
                            E('option', { 'value': 'normal', 'selected': prio === 'normal' ? 'selected' : null }, _('Normal (Standard)')),
                            E('option', { 'value': 'low', 'selected': prio === 'low' ? 'selected' : null }, _('Low (Bulk/Downloads)'))
                        ])
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Optimize for Low Ping')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 'type': 'checkbox', 'id': 'limit_ping', 'checked': ping ? 'checked' : null }),
                        E('label', { 'for': 'limit_ping' }, ' ' + _('Enable ACK Filtering & DiffServ (Best for Gaming)'))
                    ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Enable Schedule')),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 
                            'type': 'checkbox', 'id': 'limit_sched', 'checked': sched ? 'checked' : null,
                            'change': function(e) { document.getElementById('sched_options').style.display = e.target.checked ? 'block' : 'none'; }
                        }),
                        E('label', { 'for': 'limit_sched' }, ' ' + _('Apply only during specific times/days'))
                    ])
                ]),
                E('div', { 'id': 'sched_options', 'style': sched ? 'display:block;' : 'display:none; background: var(--az-sysinfo-bg); padding: 15px; border-radius: 8px; margin-top: 10px;' }, [
                    E('div', { 'style': 'margin-bottom: 10px;' }, [ E('label', { 'style': 'display:inline-block; width: 80px;' }, _('Start Time:')), E('input', { 'type': 'time', 'id': 'limit_st', 'value': st }) ]),
                    E('div', { 'style': 'margin-bottom: 15px;' }, [ E('label', { 'style': 'display:inline-block; width: 80px;' }, _('End Time:')), E('input', { 'type': 'time', 'id': 'limit_et', 'value': et }) ]),
                    E('div', {}, daysHtml)
                ])
            ]),
            E('div', { 'class': 'right' }, [
                !isNew ? E('button', { 'class': 'btn cbi-button cbi-button-remove', 'style': 'float: left; background: #dc3545; color: white;', 'click': function() { self.deleteLimit(target); } }, _('Delete Rule')) : '',
                E('button', { 'class': 'btn cbi-button cbi-button-remove', 'click': L.hideModal }, _('Cancel')), ' ',
                E('button', {
                    'class': 'btn cbi-button cbi-button-action important',
                    'click': function() {
                        var finalTarget = isNew ? document.getElementById('qos_target').value.replace(/\s+/g, '') : target;
                        if (!finalTarget) { alert('Please enter an IP or Range'); return; }
                        
                        var newDl = document.getElementById('dl_limit_input').value;
                        var newUl = document.getElementById('ul_limit_input').value;
                        var lType = document.getElementById('limit_type').value;
                        var lPrio = document.getElementById('limit_prio').value;
                        var lPing = document.getElementById('limit_ping').checked;
                        var lSched = document.getElementById('limit_sched').checked;
                        var lSt = document.getElementById('limit_st').value;
                        var lEt = document.getElementById('limit_et').value;
                        var lDays = [];
                        document.querySelectorAll('.day-chk:checked').forEach(function(e) { lDays.push(e.value); });

                        self.saveLimit(finalTarget, newDl, newUl, lType, lPrio, lPing, lSched, lSt, lEt, lDays.join(','));
                    }
                }, _('Save & Apply'))
            ])
        ]);
        L.showModal(_('QoS Settings'), m);
    },

    deleteLimit: function(ip) { this.saveLimit(ip, 0, 0, 'strict', 'normal', false, false, '', '', ''); },

    saveLimit: function(ip, dl, ul, type, prio, ping, sched, st, et, days) {
        var self = this;
        L.resolveDefault(L.fs.read('/root/azizi_netspeed/bwlimit/limits.json'), '{}').then(function(res) {
            var limits = {};
            try { limits = JSON.parse(res); } catch(e) {}
            dl = parseInt(dl); ul = parseInt(ul);

            if ((isNaN(dl) || dl <= 0) && (isNaN(ul) || ul <= 0) && prio === 'normal' && !ping) { delete limits[ip]; } 
            else { limits[ip] = { dl: isNaN(dl) ? 0 : dl, ul: isNaN(ul) ? 0 : ul, type: type, prio: prio, ping: ping, sched: sched, start_time: st, end_time: et, days: days }; }
            
            return L.fs.write('/root/azizi_netspeed/bwlimit/limits.json', JSON.stringify(limits, null, 2));
        }).then(function() {
            return L.resolveDefault(L.fs.exec('/bin/sh', ['/root/azizi_netspeed/bwlimit/apply_limits.sh', 'force']), {});
        }).then(function() {
            L.hideModal();
            L.ui.addNotification(null, E('p', _('QoS Rules updated.')), 'info');
        }).catch(function(e) { L.hideModal(); });
    },

    render: function(res) {
        var self = this;
        var yData = this.processYesterday(res[0], res[1], res[2], res[3]);

        var yd = new Date();
        yd.setDate(yd.getDate() - 1);
        var yDateStr = yd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

        var yesterdayTableBody = E('div', { 'class': 'y-body', 'id': 'y_table_body', 'style': 'display: none;' }, [
            E('div', { 'class': 'table-box', 'style': 'border: none; border-radius: 0 0 10px 10px; margin: 0;' }, [
                E('table', { 'class': 'device-table' }, [
                    E('thead', {}, E('tr', {}, [ E('th', {}, _('Device')), E('th', {}, _('Download')), E('th', {}, _('Upload')), E('th', {}, _('Total Used')) ])),
                    E('tbody', {}, yData.rows)
                ])
            ])
        ]);

        var m = E('div', { 'class': 'azizi-container' }, [
            E('style', {}, [
                ':root { --az-bg-card: #ffffff; --az-border: #e0e0e0; --az-text-main: #222; --az-text-muted: #888; --az-table-header: #f5f5f5; --az-table-hover: #fafafa; --az-badge-bg: rgba(0,0,0,0.03); --az-y-header: linear-gradient(90deg, #f8f8f8, #f0f0f0); --az-sysinfo-bg: #f5f5f5; }',
                '@media (prefers-color-scheme: dark) { :root { --az-bg-card: #1a1a1a; --az-border: #333; --az-text-main: #eee; --az-text-muted: #888; --az-table-header: #2D2D2D; --az-table-hover: #1f1f1f; --az-badge-bg: rgba(255,255,255,0.03); --az-y-header: linear-gradient(90deg, #181818, #111); --az-sysinfo-bg: #111; } }',
                '.azizi-container { max-width: 1200px; margin: 0 auto; padding: 10px; color: var(--az-text-main); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
                '.top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-wrap: wrap; gap: 12px; }',
                '.page-title { margin: 0; font-weight: 600; font-size: 1.6rem; color: var(--az-text-main); }',
                '.summary-box { display: flex; gap: 14px; margin-bottom: 25px; flex-wrap: wrap; }',
                '.card { flex: 1; min-width: 200px; background: var(--az-bg-card); border: 1px solid var(--az-border); border-radius: 12px; padding: 18px; text-align: center; }',
                '.card h4 { color: var(--az-text-muted); font-size: 0.72rem; text-transform: uppercase; margin: 0 0 8px; }',
                '.card .val { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; display: block; }',
                '.card .sub { color: var(--az-text-muted); font-size: 0.76rem; }',
                '.table-box { background: var(--az-bg-card); border: 1px solid var(--az-border); border-radius: 12px; overflow-x: auto; margin-bottom: 25px; }',
                '.device-table { width: 100%; border-collapse: collapse; min-width: 650px; }',
                '.device-table th { background: var(--az-table-header); padding: 12px 14px; text-align: left; color: var(--az-text-muted); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid var(--az-border); }',
                '.device-table td { padding: 12px 14px; border-bottom: 1px solid var(--az-border); vertical-align: middle; }',
                '.device-table tr:hover td { background: var(--az-table-hover); }',
                '.hostname { color: var(--az-text-main); font-weight: 600; font-size: 0.95rem; }',
                '.info-sub { color: var(--az-text-muted); font-size: 0.72rem; display: block; font-family: monospace; margin-top: 2px; }',
                '.tag { font-size: 0.62rem; padding: 2px 7px; border-radius: 4px; font-weight: 600; display: inline-block; margin-left: 8px; vertical-align: text-bottom; }',
                '.tag.online { background: rgba(76,175,80,0.15); color: #4caf50; border: 1px solid rgba(76,175,80,0.25); }',
                '.tag.offline { background: var(--az-badge-bg); color: var(--az-text-muted); border: 1px solid var(--az-border); }',
                '.tag.qos { background: rgba(156,39,176,0.15); color: #9c27b0; border: 1px solid rgba(156,39,176,0.25); display: inline-block; margin-right: 5px; margin-top: 5px; padding: 3px 8px; border-radius: 20px;}',
                '.tag.sched { background: rgba(3,169,244,0.15); color: #03a9f4; border: 1px solid rgba(3,169,244,0.25); display: inline-block; margin-right: 5px; margin-top: 5px; padding: 3px 8px; border-radius: 20px;}',
                '.btn-qos { background: transparent; border: 1px solid var(--az-border); color: var(--az-text-main); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight:bold; transition: 0.2s; }',
                '.btn-qos:hover { background: #9c27b0; color: white; border-color: #9c27b0; }',
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
            ].join('\n')),

            E('div', { 'class': 'top-bar' }, [
                E('div', { 'style': 'display:flex; align-items:center; gap:15px;' }, [
                    E('h2', { 'class': 'page-title' }, this.title),
                    E('button', { 'class': 'btn-qos', 'click': function() { self.showLimitModal(null, null, null); } }, _('+ Add Custom Rule')),
                    E('button', { 'class': 'btn-qos', 'style': 'background: var(--az-sysinfo-bg); border-style: dashed;', 'id': 'btn_global_settings' }, _('⚙️ Global Settings'))
                ]),
                E('span', { 'class': 'sys-info-box', 'id': 'sys_time_el', 'style': 'font-family:monospace; background:var(--az-sysinfo-bg); padding: 5px 10px; border-radius:6px; color:var(--az-text-muted);' }, '...')
            ]),

            E('div', { 'id': 'summary_area', 'class': 'summary-box' }, [
                this.renderCard('Total Load', '0.00 kb/s', '0 KB', '#ffd700'),
                this.renderCard('Download', '\u2193 0.00 kb/s', '0 KB', '#4caf50'),
                this.renderCard('Upload', '\u2191 0.00 kb/s', '0 KB', '#ff9800')
            ]),

            E('div', { 'class': 'y-wrapper', 'id': 'y_wrapper' }, [
                E('div', {
                    'class': 'y-header',
                    'click': function() {
                        var wrap = document.getElementById('y_wrapper');
                        var body = document.getElementById('y_table_body');
                        if (wrap.classList.contains('open')) { body.style.display = 'none'; wrap.classList.remove('open'); } 
                        else { body.style.display = 'block'; wrap.classList.add('open'); }
                    }
                }, [
                    E('div', { 'class': 'y-title-area' }, [
                        E('h3', { 'class': 'y-title' }, [ _("Yesterday's Total Usage"), ' ', E('span', { 'class': 'y-date' }, '(' + yDateStr + ')') ]),
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

            E('div', { 'class': 'table-box' }, [
                E('h3', { 'style': 'padding: 15px; margin: 0; border-bottom: 1px solid var(--az-border); color: var(--az-text-main); font-size: 1.1rem;' }, _('\uD83D\uDCDC Active QoS & Limit Rules')),
                E('table', { 'class': 'device-table' }, [
                    E('thead', {}, E('tr', {}, [ E('th', {}, _('Target')), E('th', {}, _('Limits (DL/UL)')), E('th', {}, _('Settings')), E('th', {}, _('Schedule')), E('th', { 'style': 'text-align: center;' }, _('Actions')) ])),
                    E('tbody', { 'id': 'qos_body' })
                ])
            ]),

            E('div', { 'class': 'table-box' }, [
                E('h3', { 'style': 'padding: 15px; margin: 0; border-bottom: 1px solid var(--az-border); color: var(--az-text-main); font-size: 1.1rem;' }, _('\uD83D\uDCBB Live Devices Traffic')),
                E('table', { 'class': 'device-table' }, [
                    E('thead', {}, E('tr', {}, [ E('th', {}, _('Device')), E('th', {}, _('Download')), E('th', {}, _('Upload')), E('th', {}, _('Total')), E('th', { 'style': 'text-align: center;' }, _('Quick Limit')) ])),
                    E('tbody', { 'id': 'device_body' })
                ])
            ]),

            // DEVELOPER CREDIT FOOTER
            E('div', {  'style': 'margin-top:40px; padding:20px; border-top:1px solid #333; text-align:center; font-size:0.85rem; color:#777; line-height:1.6;' }, [
                E('div', {}, [ E('strong', { 'style': 'color:#eee' }, 'Azizi_NetSpeed'), ' project' ]),
                E('div', {}, [ 'Developed by ', E('span', { 'style': 'color:#ffd700; font-weight:bold;' }, 'Mohammad Azizi') ]),
                E('a', { 
                    'href': 'https://github.com/Mohammad-Azizi/Azizi_netspeed', 'target': '_blank',
                    'style': 'color:#4caf50; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; margin-top:12px; border:1px solid #444; padding:6px 16px; border-radius:20px; background:#222; gap:8px;'
                }, [
                    E('img', { 'src': L.resource('view/azizi_netspeed/icons/github.svg'), 'width': 16, 'height': 16, 'style': 'filter: invert(58%) sepia(13%) saturate(1200%) hue-rotate(76deg) brightness(95%) contrast(80%);', 'class': 'middle' }),
                    _('Follow on GitHub')
                ])
            ])
        ]);

        L.Poll.add(L.bind(function() {
            return Promise.all([
                getHostHints(),
                L.resolveDefault(L.fs.exec('/usr/sbin/nft', ['-j', 'list', 'set', 'inet', 'fw4', 'up_per_ip']), {}),
                L.resolveDefault(L.fs.exec('/usr/sbin/nft', ['-j', 'list', 'set', 'inet', 'fw4', 'down_per_ip']), {}),
                L.resolveDefault(L.fs.exec('/bin/date', ['+%Y-%m-%d %H:%M:%S']), {}),
                L.resolveDefault(L.fs.read('/root/azizi_netspeed/usage/hosts.json'), '{}'),
                L.resolveDefault(L.fs.read('/root/azizi_netspeed/bwlimit/limits.json'), '{}')
            ]).then(L.bind(function(r) { this.updateUI(r[0], r[1], r[2], r[3], r[4], r[5]); }, this));
        }, this), 3);

        return m;
    },

    updateUI: function(hints, upRes, downRes, dateRes, savedHostsStr, limitsStr) {
        var self = this;
        var el = document.getElementById('sys_time_el');
        if (el) el.innerText = (dateRes && dateRes.stdout) ? dateRes.stdout.trim() : '...';

        var upData = {}, downData = {}, savedHosts = {}, limits = {};
        try { upData = typeof upRes.stdout === 'string' ? JSON.parse(upRes.stdout) : {}; } catch(e) {}
        try { downData = typeof downRes.stdout === 'string' ? JSON.parse(downRes.stdout) : {}; } catch(e) {}
        try { savedHosts = typeof savedHostsStr === 'string' ? JSON.parse(savedHostsStr) : {}; } catch(e) {}
        try { limits = typeof limitsStr === 'string' ? JSON.parse(limitsStr) : {}; } catch(e) {}

        var btnGlob = document.getElementById('btn_global_settings');
        if (btnGlob) { btnGlob.onclick = function() { self.showGlobalSettingsModal(limits['__global_settings']); }; }

        var RA = {}, tDL = 0, tUL = 0, tDLB = 0, tULB = 0;

        var findInfo = function(ip) {
            var host = null;
            if (hints) Object.keys(hints).forEach(function(mac) {
                var h = hints[mac];
                if (h.ipaddrs && h.ipaddrs.includes(ip)) host = { name: h.name || ip, mac: mac };
            });
            if ((!host || host.name === ip) && savedHosts[ip]) host = { name: savedHosts[ip].name || ip, mac: savedHosts[ip].mac || '\u2014' };
            return { name: (host && host.name) ? host.name : ip, mac: (host && host.mac) ? host.mac : '\u2014' };
        };

        var qosRows = [];
        Object.keys(limits).forEach(function(target) {
            if (target === '__global_settings') return; 
            
            var l = limits[target];
            var typeBadge = l.type === 'strict' ? 'Strict' : 'Shared';
            var prioBadge = l.prio === 'high' ? 'High Prio' : (l.prio === 'low' ? 'Low Prio' : 'Normal Prio');
            var pingBadge = l.ping ? 'Ping Opt' : null;

            var schedTxt = E('span', { 'style': 'color: var(--az-text-muted); font-size: 0.8rem;' }, _('Permanent'));
            if (l.sched) {
                var dArr = l.days ? l.days.split(',') : [];
                var dStr = dArr.length === 7 ? 'Everyday' : dArr.length + ' days/wk';
                schedTxt = E('span', { 'class': 'tag sched' }, '\u23F0 ' + dStr + ' (' + l.start_time + ' - ' + l.end_time + ')');
            }

            qosRows.push(E('tr', {}, [
                E('td', {}, E('strong', { 'class': 'hostname' }, target)),
                E('td', {}, [ E('div', {}, '\u2193 ' + (l.dl > 0 ? l.dl + ' Kbps' : 'Unlimited')), E('div', {}, '\u2191 ' + (l.ul > 0 ? l.ul + ' Kbps' : 'Unlimited')) ]),
                E('td', {}, [
                    E('span', { 'class': 'tag qos' }, typeBadge),
                    l.prio !== 'normal' ? E('span', { 'class': 'tag qos' }, prioBadge) : '',
                    pingBadge ? E('span', { 'class': 'tag qos' }, pingBadge) : ''
                ]),
                E('td', {}, schedTxt),
                E('td', { 'style': 'text-align: center;' }, [ E('button', { 'class': 'btn-qos', 'click': function() { self.showLimitModal(target, target, l); } }, _('Edit')) ])
            ]));
        });
        if (qosRows.length === 0) qosRows.push(E('tr', {}, E('td', { 'colspan': '5', 'style': 'text-align:center; padding: 20px; color: var(--az-text-muted);' }, _('No custom rules applied.'))));
        L.dom.content(document.getElementById('qos_body'), qosRows);

        var process = function(json, type) {
            var set = (json.nftables || []).find(function(i) { return i.set; });
            if (!set || !set.set || !set.set.elem) return;
            set.set.elem.forEach(function(item) {
                var e = item.elem, ip = e.val;
                if (!RA[ip]) { RA[ip] = { dl:0, ul:0, t_dl:0, t_ul:0, expires:0, name: findInfo(ip).name, mac: findInfo(ip).mac }; }
                var bytes = (e.counter && e.counter.bytes) ? e.counter.bytes : 0;
                var rate = (RC[type + ip] && bytes >= RC[type + ip]) ? (bytes - RC[type + ip]) / 3 : 0;
                RC[type + ip] = bytes;

                if (e.expires) RA[ip].expires = Math.max(RA[ip].expires, e.expires);
                if (type === 'u') { RA[ip].ul = rate; RA[ip].t_ul = bytes; } else { RA[ip].dl = rate; RA[ip].t_dl = bytes; }
            });
        };
        process(upData, 'u'); process(downData, 'd');

        var rows = [];
        Object.keys(RA).sort(function(a, b) { return (RA[b].dl + RA[b].ul) - (RA[a].dl + RA[a].ul); }).forEach(function(ip) {
            var d = RA[ip]; tDL += d.dl; tUL += d.ul; tDLB += d.t_dl; tULB += d.t_ul;
            var agoText = self.formatDiff(86400 - d.expires);
            var statusTag = !agoText ? E('span', { 'class': 'tag online' }, _('Online')) : E('span', { 'class': 'tag offline' }, agoText);
            var curLimits = limits[ip];

            rows.push(E('tr', {}, [
                E('td', {}, [ E('div', {}, [E('span', { 'class': 'hostname' }, d.name), ' ', statusTag]), E('span', { 'class': 'info-sub' }, ip + ' | ' + d.mac) ]),
                E('td', {}, [ E('span', { 'style': 'color:#4caf50' }, '\u2193 ' + self.speed_label(d.dl)), E('div', { 'class': 'info-sub' }, self.bytes_label(d.t_dl)) ]),
                E('td', {}, [ E('span', { 'style': 'color:#ff9800' }, '\u2191 ' + self.speed_label(d.ul)), E('div', { 'class': 'info-sub' }, self.bytes_label(d.t_ul)) ]),
                E('td', {}, [ E('strong', { 'style': 'color:#ffd700' }, self.speed_label(d.dl + d.ul)), E('div', { 'class': 'info-sub' }, self.bytes_label(d.t_dl + d.t_ul)) ]),
                E('td', { 'style': 'text-align: center;' }, [ E('button', { 'class': 'btn-qos', 'style': curLimits ? 'background: #9c27b0; color: white;' : '', 'click': function() { self.showLimitModal(ip, d.name, curLimits); } }, curLimits ? _('Edit limit') : _('Limit')) ])
            ]));
        });
        if (rows.length === 0) rows.push(E('tr', {}, E('td', { 'colspan': '5', 'style': 'text-align:center; padding: 20px; color: var(--az-text-muted);' }, _('No active devices.'))));

        L.dom.content(document.getElementById('device_body'), rows);
        L.dom.content(document.getElementById('summary_area'), [
            self.renderCard('Total Network Load', self.speed_label(tDL + tUL), self.bytes_label(tDLB + tULB), '#ffd700'),
            self.renderCard('Download', '\u2193 ' + self.speed_label(tDL), self.bytes_label(tDLB), '#4caf50'),
            self.renderCard('Upload', '\u2191 ' + self.speed_label(tUL), self.bytes_label(tULB), '#ff9800')
        ]);
    },

    renderCard: function(title, val, usage, color) {
        return E('div', { 'class': 'card', 'style': 'border-top: 3px solid ' + color }, [
            E('h4', {}, _(title)), E('span', { 'class': 'val', 'style': 'color:' + color }, val), usage ? E('span', { 'class': 'sub' }, usage) : ''
        ]);
    }
});