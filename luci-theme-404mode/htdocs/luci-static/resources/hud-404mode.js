'use strict';
'require baseclass';
'require rpc';

/*
 * 404 Mode — "ГОСТ-24" telemetry HUD
 *
 *  - sidebar telemetry: sparkline + value + status pill per menu category
 *  - radar: DHCP clients as blips, syslog tail, temperature, uptime
 *  - status overview dashboard: CPU / RAM / traffic charts, telemetry strip,
 *    process list; native overview sections laid out as a tile grid
 *
 * Every data source is optional: a failing call (missing ACL, absent sensor,
 * no busybox top…) only blanks the related widget.
 *
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const callSystemInfo = rpc.declare({ object: 'system', method: 'info' });
const callSystemBoard = rpc.declare({ object: 'system', method: 'board' });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
const callProcs = rpc.declare({ object: 'luci', method: 'getProcessList', expect: { result: [] } });
const callRead = rpc.declare({ object: 'file', method: 'read', params: [ 'path' ], expect: { data: '' } });
const callExec = rpc.declare({ object: 'file', method: 'exec', params: [ 'command', 'params' ], expect: { '': {} } });

const HIST = 48;
const VPN_PROTOS = [ 'wireguard', 'openvpn', 'amneziawg', 'openconnect', 'sstp', 'vpnc', 'pptp', 'l2tp', 'gre', 'vxlan' ];
const RU = (document.documentElement.lang || '').substr(0, 2) == 'ru';

const T = RU ? {
	made: 'Сделано в OpenWrt', host: 'Узел', fw: 'Прошивка', kernel: 'Ядро', uptime: 'Аптайм', time: 'Время',
	cpu: 'Загрузка ЦП', ram: 'ОЗУ', traffic: 'Трафик', strip: 'Телеметрия', procs: 'Процессы',
	load: 'НАГРУЗКА', conn: 'СОЕДИН.', clients: 'КЛИЕНТЫ', temp: 'ТЕМП.', wan: 'АПЛИНК',
	nolog: 'журнал недоступен', noproc: 'нет данных о процессах', d: 'д', h: 'ч', m: 'м'
} : {
	made: 'Made in OpenWrt', host: 'Host', fw: 'Firmware', kernel: 'Kernel', uptime: 'Uptime', time: 'Time',
	cpu: 'CPU Load', ram: 'RAM', traffic: 'Traffic Chart', strip: 'Telemetry', procs: 'Processes',
	load: 'LOAD', conn: 'CONN', clients: 'CLIENTS', temp: 'TEMP', wan: 'UPLINK',
	nolog: 'log unavailable', noproc: 'no process data', d: 'd', h: 'h', m: 'm'
};

/* ---------- helpers ---------- */

function safe(p, fallback) {
	return Promise.resolve(p).catch(() => fallback);
}

function push(arr, v) {
	arr.push(v);
	while (arr.length > HIST)
		arr.shift();
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function fmtRate(bps) {
	if (!isFinite(bps) || bps < 0)
		return '—';
	const u = [ 'B/s', 'K/s', 'M/s', 'G/s' ];
	let i = 0;
	while (bps >= 1024 && i < u.length - 1) {
		bps /= 1024;
		i++;
	}
	return (bps >= 100 || i == 0 ? bps.toFixed(0) : bps.toFixed(1)) + ' ' + u[i];
}

function fmtBytes(b) {
	const u = [ 'B', 'KiB', 'MiB', 'GiB' ];
	let i = 0;
	while (b >= 1024 && i < u.length - 1) {
		b /= 1024;
		i++;
	}
	return b.toFixed(i ? 2 : 0) + ' ' + u[i];
}

function fmtUptime(s) {
	if (!isFinite(s))
		return '--';
	const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
	return d ? `${d}${T.d} ${h}${T.h}` : (h ? `${h}${T.h} ${m}${T.m}` : `${m}${T.m}`);
}

function pad(n) {
	return (n < 10 ? '0' : '') + n;
}

function hhmm(t) {
	const d = new Date(t);
	return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function hhmmss(t) {
	const d = new Date(t);
	return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function hash(str, seed) {
	let h = seed || 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0);
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- tiny SVG chart kit ---------- */

function sparkBars(data, max) {
	const n = 16, w = 56, h = 16, bw = w / n;
	const src = data.slice(-n);
	const m = max || Math.max(1, ...src);
	let out = '';

	for (let i = 0; i < n; i++) {
		const v = src[i - (n - src.length)];
		if (v == null)
			continue;
		const bh = Math.max(1, clamp(v / m, 0, 1) * (h - 1));
		out += `<rect x="${(i * bw + .5).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}"/>`;
	}

	return `<svg class="gt-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
}

function lineChart(el, series, opt) {
	const W = Math.max(120, el.clientWidth), H = Math.max(60, el.clientHeight);
	const L = 34, R = 6, Tp = 8, B = 16;
	const cw = W - L - R, ch = H - Tp - B;
	const max = opt.max || Math.max(1e-9, ...series.flatMap(s => s.data)) * 1.15;
	const n = Math.max(2, HIST);
	const x = i => L + cw * i / (n - 1);
	const y = v => Tp + ch - clamp(v / max, 0, 1) * ch;
	let g = '';

	for (let i = 0; i <= 4; i++) {
		const yy = Tp + ch * i / 4;
		g += `<line class="gc-grid" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
		g += `<text class="gc-y" x="${L - 5}" y="${(yy + 3).toFixed(1)}">${esc(opt.fmt(max * (4 - i) / 4))}</text>`;
	}

	for (let i = 0; i < n; i += 8)
		g += `<line class="gc-grid gc-v" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${Tp}" y2="${Tp + ch}"/>`;

	const ts = opt.ts || [];
	const off = n - ts.length;
	for (let i = 0; i < ts.length; i += 12)
		g += `<text class="gc-x" x="${x(i + off).toFixed(1)}" y="${H - 4}">${hhmmss(ts[i]).substr(0, 5)}</text>`;

	for (const s of series) {
		const o = n - s.data.length;
		if (s.data.length < 2)
			continue;
		const pts = s.data.map((v, i) => `${x(i + o).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
		if (s.area)
			g += `<polygon class="gc-area ${s.cls}" points="${x(o).toFixed(1)},${Tp + ch} ${pts} ${x(n - 1).toFixed(1)},${Tp + ch}"/>`;
		g += `<polyline class="gc-line ${s.cls}" points="${pts}"/>`;
	}

	if (opt.limit != null) {
		const ly = y(opt.limit).toFixed(1);
		g += `<line class="gc-limit" x1="${L}" x2="${W - R}" y1="${ly}" y2="${ly}"/>`;
	}

	g += `<line class="gc-axis" x1="${L}" x2="${L}" y1="${Tp}" y2="${Tp + ch}"/><line class="gc-axis" x1="${L}" x2="${W - R}" y1="${Tp + ch}" y2="${Tp + ch}"/>`;
	el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
}

function barChart(el, a, b, opt) {
	const W = Math.max(120, el.clientWidth), H = Math.max(60, el.clientHeight);
	const L = 44, R = 6, Tp = 8, B = 16;
	const cw = W - L - R, ch = H - Tp - B;
	const max = Math.max(1024, ...a, ...b) * 1.15;
	const slot = cw / HIST, bw = Math.max(1, slot / 2 - 1);
	const y = v => Tp + ch - clamp(v / max, 0, 1) * ch;
	let g = '';

	for (let i = 0; i <= 4; i++) {
		const yy = Tp + ch * i / 4;
		g += `<line class="gc-grid" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
		g += `<text class="gc-y" x="${L - 5}" y="${(yy + 3).toFixed(1)}">${esc(fmtRate(max * (4 - i) / 4))}</text>`;
	}

	const o = HIST - a.length;
	for (let i = 0; i < a.length; i++) {
		const x0 = L + (i + o) * slot;
		g += `<rect class="gb-a" x="${x0.toFixed(1)}" y="${y(a[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Tp + ch - y(a[i])).toFixed(1)}"/>`;
		g += `<rect class="gb-b" x="${(x0 + bw + 1).toFixed(1)}" y="${y(b[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Tp + ch - y(b[i])).toFixed(1)}"/>`;
	}

	const ts = opt.ts || [];
	for (let i = 0; i < ts.length; i += 12)
		g += `<text class="gc-x" x="${(L + (i + o) * slot).toFixed(1)}" y="${H - 4}">${hhmmss(ts[i]).substr(0, 5)}</text>`;

	g += `<line class="gc-axis" x1="${L}" x2="${W - R}" y1="${Tp + ch}" y2="${Tp + ch}"/>`;
	el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
}

/* ---------- sidebar telemetry definitions ---------- */

const CATS = {
	status: s => ({ spark: s.h.cpu, max: 100, val: Math.round(s.cpu) + '%', pill: 'ONLINE', st: s.cpu > 85 ? 'warn' : 'ok' }),
	system: s => ({ spark: s.h.mem, max: 100, val: Math.round(s.mem) + '%', pill: 'ONLINE', st: s.mem > 90 ? 'warn' : 'ok' }),
	network: s => ({ spark: s.h.rx, val: fmtRate(s.rx + s.tx), pill: s.wanUp ? 'ONLINE' : 'NO WAN', st: s.wanUp ? 'ok' : 'warn' }),
	services: s => ({ spark: s.h.load, val: s.load.toFixed(2), pill: 'RUN', st: 'ok' }),
	nas: s => ({ spark: s.h.disk, max: 100, val: s.disk != null ? Math.round(s.disk) + '%' : '—', pill: 'MOUNT', st: 'idle' }),
	vpn: s => ({ spark: s.h.tx, val: s.vpn ? s.vpn + ' LINK' : '—', pill: s.vpn ? 'SECURE' : 'OPEN', st: s.vpn ? 'ok' : 'warn' }),
	firewall: s => ({ spark: s.h.conn, val: s.conn != null ? String(s.conn) : '—', pill: 'SECURE', st: 'ok' }),
	modem: s => ({ spark: s.h.rx, val: s.wanUp ? 'LINK' : '—', pill: s.wanUp ? 'ONLINE' : 'SEARCH', st: s.wanUp ? 'ok' : 'warn' }),
	statistics: s => ({ spark: s.h.cpu, max: 100, val: '', pill: 'REC', st: 'idle' }),
	docker: s => ({ spark: s.h.load, val: '', pill: 'RUN', st: 'idle' }),
	logout: s => ({ spark: null, val: '', pill: 'STBY', st: 'idle' }),
	_default: s => ({ spark: s.h.load, val: '', pill: 'IDLE', st: 'idle' })
};

/* ---------- module ---------- */

return baseclass.extend({
	__init__() {
		this.overview = (L.env.dispatchpath || []).join('/') == 'admin/status/overview';
		this.interval = this.overview ? 3000 : Math.max(3, L.env.pollinterval || 5) * 1000;
		this.n = 0;
		this.s = {
			cpu: 0, mem: 0, load: 0, rx: 0, tx: 0, conn: null, disk: null, vpn: 0, wanUp: false,
			temp: null, uptime: NaN, clients: 0, leases: [],
			memUsed: 0, memTotal: 0,
			h: { cpu: [], mem: [], load: [], rx: [], tx: [], conn: [], disk: [], clients: [], ts: [] }
		};
		this.prevStat = null;
		this.prevBytes = null;
		this.wanDev = null;

		safe(callSystemBoard(), {}).then(b => { this.board = b || {}; this.renderPlaque(); });

		if (window.__404menuReady)
			this.attachMenu();
		else
			document.addEventListener('404mode-menu', () => this.attachMenu(), { once: true });

		if (this.overview)
			this.buildDashboard();

		window.addEventListener('resize', () => this.drawCharts());
		document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });

		this.kick();
	},

	kick() {
		window.clearTimeout(this.timer);
		this.tick().finally(() => {
			this.timer = window.setTimeout(() => {
				if (document.hidden)
					return;
				this.kick();
			}, this.interval);
		});
	},

	/* ---------- data ---------- */

	tick() {
		const n = this.n++;
		const s = this.s;
		const jobs = [
			safe(callSystemInfo(), null),
			safe(callDevices(), null),
			safe(callLeases(), null),
			safe(callRead('/proc/stat'), null),
			safe(callRead('/sys/class/thermal/thermal_zone0/temp'), null),
			safe(callRead('/proc/sys/net/netfilter/nf_conntrack_count'), null),
			(n % 6 == 0) ? safe(callIfaces(), null) : Promise.resolve(undefined),
			(this.overview) ? safe(callProcs(), null) : Promise.resolve(undefined),
			(n % 3 == 0) ? safe(callExec('/sbin/logread', [ '-l', '9' ]), null) : Promise.resolve(undefined)
		];

		return Promise.all(jobs).then(([ info, devs, leases, stat, temp, conn, ifaces, procs, log ]) => {
			const now = Date.now();

			if (ifaces !== undefined && ifaces)
				this.parseIfaces(ifaces);

			/* memory, load, uptime, disk */
			if (info) {
				const m = info.memory || {};
				const avail = m.available != null ? m.available : (m.free || 0) + (m.buffered || 0) + (m.cached || 0);
				s.memTotal = m.total || 0;
				s.memUsed = Math.max(0, s.memTotal - avail);
				s.mem = s.memTotal ? s.memUsed / s.memTotal * 100 : 0;
				s.load = (info.load?.[0] || 0) / 65536;
				s.uptime = info.uptime;
				if (info.root?.total)
					s.disk = (info.root.used ?? (info.root.total - info.root.free)) / info.root.total * 100;
			}

			/* cpu % from /proc/stat, fallback to load */
			let cpu = null;
			if (stat) {
				const f = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
				const idle = (f[3] || 0) + (f[4] || 0), total = f.reduce((a, b) => a + (b || 0), 0);
				if (this.prevStat && total > this.prevStat.total)
					cpu = 100 * (1 - (idle - this.prevStat.idle) / (total - this.prevStat.total));
				this.prevStat = { idle, total };
			}
			s.cpu = clamp(cpu != null ? cpu : s.load * 100, 0, 100);

			/* traffic on uplink device */
			if (devs) {
				const name = (this.wanDev && devs[this.wanDev]) ? this.wanDev : this.guessDev(devs);
				const st = devs[name]?.stats;
				if (st) {
					if (this.prevBytes && this.prevBytes.dev == name) {
						const dt = Math.max(.5, (now - this.prevBytes.t) / 1000);
						s.rx = Math.max(0, (st.rx_bytes - this.prevBytes.rx) / dt);
						s.tx = Math.max(0, (st.tx_bytes - this.prevBytes.tx) / dt);
					}
					this.prevBytes = { dev: name, t: now, rx: st.rx_bytes, tx: st.tx_bytes };
				}
				if (!this.vpnFromIfaces)
					s.vpn = Object.keys(devs).filter(d => /^(wg|tun|awg|tap)/.test(d) && devs[d].up).length;
			}

			if (leases) {
				s.leases = leases.dhcp_leases || [];
				s.clients = s.leases.length;
			}

			s.temp = temp ? parseInt(temp, 10) / 1000 : null;
			s.conn = conn ? parseInt(conn, 10) : null;

			push(s.h.cpu, s.cpu);
			push(s.h.mem, s.mem);
			push(s.h.load, s.load);
			push(s.h.rx, s.rx);
			push(s.h.tx, s.tx);
			push(s.h.conn, s.conn || 0);
			push(s.h.disk, s.disk || 0);
			push(s.h.clients, s.clients);
			push(s.h.ts, now);

			this.renderMenu();
			this.renderRadar(log);
			this.renderDashboard(procs);
		});
	},

	parseIfaces(list) {
		let wan = null, vpn = 0;

		for (const i of list) {
			const def = (i.route || []).some(r => r.target == '0.0.0.0' && r.mask == 0);
			if (def && i.up && !wan)
				wan = i;
			if (i.up && VPN_PROTOS.indexOf(i.proto) > -1)
				vpn++;
		}

		this.s.wanUp = !!wan;
		this.wanDev = wan ? (wan.l3_device || wan.device) : this.wanDev;
		this.s.vpn = vpn;
		this.vpnFromIfaces = true;
	},

	guessDev(devs) {
		let best = null, max = -1;
		for (const name in devs) {
			const d = devs[name];
			if (name == 'lo' || !d?.stats || /^(br-|wg|tun|awg|ifb|veth)/.test(name))
				continue;
			const b = (d.stats.rx_bytes || 0) + (d.stats.tx_bytes || 0);
			if (b > max) {
				max = b;
				best = name;
			}
		}
		return best;
	},

	/* ---------- sidebar ---------- */

	attachMenu() {
		this.cells = [];

		document.querySelectorAll('#mainmenu .nav > li').forEach(li => {
			const m = li.className.match(/nav-(?:cat|leaf)-([^\s]+)/);
			const name = m ? m[1] : '';
			const cell = E('span', { 'class': 'gt', 'aria-hidden': 'true' });
			li.appendChild(cell);
			this.cells.push({ name, cell, def: CATS[name] || CATS._default });
		});

		this.renderMenu();
	},

	renderMenu() {
		if (!this.cells)
			return;

		for (const c of this.cells) {
			const r = c.def(this.s);
			c.cell.className = 'gt gt-' + r.st;
			c.cell.innerHTML =
				(r.spark ? `<span class="gt-well">${sparkBars(r.spark, r.max)}</span>` : '<span class="gt-well gt-well-empty"></span>') +
				`<b class="gt-val">${esc(r.val)}</b>` +
				`<span class="gt-pill">${esc(r.pill)}</span>`;
		}
	},

	/* ---------- radar ---------- */

	renderRadar(log) {
		const s = this.s;
		const blips = document.getElementById('gost-blips');
		const temp = document.getElementById('gost-temp');
		const up = document.getElementById('gost-uptime');
		const list = document.getElementById('gost-log');

		if (temp)
			temp.textContent = (s.temp != null && isFinite(s.temp)) ? Math.round(s.temp) + '°C' : '--';
		if (up)
			up.textContent = fmtUptime(s.uptime);

		if (blips) {
			const key = s.leases.map(l => l.macaddr).join();
			if (key != this.blipKey) {
				this.blipKey = key;
				blips.innerHTML = s.leases.slice(0, 24).map(l => {
					const id = (l.macaddr || l.ipaddr || '') + '';
					const ang = hash(id) % 360, r = .28 + (hash(id, 7) % 1000) / 1000 * .62;
					const x = 50 + 50 * r * Math.sin(ang * Math.PI / 180);
					const y = 50 - 50 * r * Math.cos(ang * Math.PI / 180);
					const delay = (ang / 360 * 4).toFixed(2);
					return `<i class="blip" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;animation-delay:${delay}s" title="${esc(l.hostname || l.ipaddr)}"></i>`;
				}).join('');
			}
		}

		if (list && log !== undefined) {
			const lines = (log && log.code == 0 && log.stdout) ? log.stdout.trim().split('\n').slice(-9) : null;

			if (lines && lines.length) {
				list.innerHTML = lines.reverse().map(line => {
					const m = line.match(/^\w{3} \w{3} +\d+ (\d\d:\d\d):\d\d \d{4} ([\w.]+) (.*)$/);
					const t = m ? m[1] : '';
					const lvl = m ? m[2] : '';
					const msg = (m ? m[3] : line).replace(/^[^:\[]+\[\d+\]: /, s => s.replace(/\[\d+\]/, ''));
					const bad = /\.(err|crit|alert|emerg|warn)/.test(lvl);
					return `<li class="${bad ? 'bad' : ''}"><time>${esc(t)}</time>${esc(msg)}</li>`;
				}).join('');
			}
			else if (s.leases.length) {
				list.innerHTML = s.leases.slice(0, 9).map(l =>
					`<li><time>DHCP</time>${esc(l.hostname || '?')} ${esc(l.ipaddr || '')}</li>`).join('');
			}
			else {
				list.innerHTML = `<li class="dim">${esc(T.nolog)}</li>`;
			}
		}
	},

	/* ---------- overview dashboard ---------- */

	tile(cls, title, legend, body) {
		return E('section', { 'class': 'gd-tile ' + cls }, [
			E('header', { 'class': 'gd-head' }, [
				E('h3', {}, [ title ]),
				E('span', { 'class': 'gd-legend' }, (legend || []).map(l =>
					E('span', { 'class': 'gd-key ' + l[0] }, [ l[1] ]))),
				E('span', { 'class': 'gd-icons', 'aria-hidden': 'true' })
			]),
			E('div', { 'class': 'gd-body' }, body)
		]);
	},

	buildDashboard() {
		const main = document.getElementById('maincontent');
		const view = document.getElementById('view');

		if (!main || !view)
			return;

		document.body.classList.add('gd-on');

		this.el = {};
		const el = this.el;
		const cell = (k, label) => E('div', { 'class': 'gd-cell' }, [
			E('span', { 'class': 'gd-cell-l' }, [ label ]),
			el[k] = E('b', { 'class': 'gd-cell-v' }, [ '--' ])
		]);

		const ruler = E('div', { 'class': 'gd-ruler' }, [
			el.needle = E('i', { 'class': 'gd-needle' }),
			E('span', { 'class': 'gd-ruler-n' }, [ 0, 20, 40, 60, 80, 100 ].map(v => E('em', {}, [ String(v) ])))
		]);

		const dash = E('div', { 'class': 'gd' }, [
			el.plaque = E('section', { 'class': 'gd-tile gd-plaque' }, [
				E('div', { 'class': 'gd-plaque-main' }, [
					E('span', { 'class': 'gd-plaque-made' }, [ T.made ]),
					el.model = E('strong', { 'class': 'gd-plaque-model' }, [ '…' ]),
					el.facts = E('dl', { 'class': 'gd-facts' })
				]),
				E('span', { 'class': 'gd-stamp' }, [ (document.querySelector('.gost-plate-tag-r') || {}).textContent || 'ГОСТ-24' ]),
				E('div', { 'class': 'gd-gauge', 'aria-hidden': 'true' }, [ el.gauge = E('i') ])
			]),
			this.tile('gd-cpu', T.cpu, [ [ 'k-a', 'CPU %' ], [ 'k-b', 'LOAD ×100' ] ], [ el.cpu = E('div', { 'class': 'gd-chart' }) ]),
			this.tile('gd-ram', T.ram, [ [ 'k-b', '' ] ], [ el.ram = E('div', { 'class': 'gd-chart' }) ]),
			this.tile('gd-strip', T.strip, [], [
				E('div', { 'class': 'gd-cells' }, [
					cell('vCpu', 'CPU'), cell('vLoad', T.load), cell('vConn', T.conn),
					cell('vCli', T.clients), cell('vTemp', T.temp), cell('vWan', T.wan)
				]),
				ruler,
				el.mini = E('div', { 'class': 'gd-chart gd-chart-mini' })
			]),
			this.tile('gd-traffic', T.traffic, [ [ 'k-a', 'RX' ], [ 'k-b', 'TX' ] ], [ el.traffic = E('div', { 'class': 'gd-chart' }) ])
		]);

		el.ramKey = dash.querySelector('.gd-ram .gd-key');
		main.insertBefore(dash, view);

		/* lay out the native overview sections once they exist */
		const wait = (tries) => {
			const secs = view.querySelectorAll(':scope > .cbi-section');
			if (!secs.length && tries > 0)
				return window.setTimeout(() => wait(tries - 1), 300);

			view.classList.add('gd-grid');
			secs.forEach(sec => {
				const h = sec.querySelector(':scope > h3');
				const t = h ? h.textContent.trim() : '';
				if (t == _('System') || t == _('Memory'))
					sec.classList.add('gd-dup');

				/* wide tables (wireless stations, ports…) get the full row */
				const wide = Array.prototype.some.call(sec.querySelectorAll('table, .table'), tb =>
					tb.querySelectorAll('.table-titles > .th, .table-titles > th').length >= 5);
				if (wide)
					sec.classList.add('gd-wide');
			});

			el.procs = E('tbody');
			view.appendChild(E('div', { 'class': 'cbi-section gd-procs' }, [
				E('h3', {}, [ T.procs ]),
				E('table', { 'class': 'table gd-proc-table' }, [
					E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, 'PID'), E('th', { 'class': 'th' }, 'USER'),
						E('th', { 'class': 'th' }, 'CPU'), E('th', { 'class': 'th' }, 'MEM'),
						E('th', { 'class': 'th' }, 'COMMAND')
					])),
					el.procs
				])
			]));
		};

		wait(60);
	},

	renderPlaque() {
		const el = this.el;
		if (!el || !this.board)
			return;

		const b = this.board;
		el.model.textContent = b.model || b.system || 'OpenWrt';
		this.drawFacts();
	},

	drawFacts() {
		const el = this.el, b = this.board || {};
		if (!el || !el.facts)
			return;

		const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
		el.facts.innerHTML =
			row(T.host, b.hostname || '?') +
			row(T.fw, b.release?.description || b.release?.version || '?') +
			row(T.kernel, b.kernel || '?') +
			row(T.uptime, fmtUptime(this.s.uptime)) +
			row(T.time, hhmmss(Date.now()));
	},

	renderDashboard(procs) {
		const el = this.el, s = this.s;
		if (!el)
			return;

		this.drawFacts();
		el.gauge.style.height = s.cpu.toFixed(1) + '%';
		el.needle.style.left = s.cpu.toFixed(1) + '%';

		el.vCpu.textContent = Math.round(s.cpu) + '%';
		el.vLoad.textContent = s.load.toFixed(2);
		el.vConn.textContent = s.conn != null ? String(s.conn) : '—';
		el.vCli.textContent = String(s.clients);
		el.vTemp.textContent = (s.temp != null && isFinite(s.temp)) ? Math.round(s.temp) + '°C' : '—';
		el.vWan.textContent = s.wanUp ? 'UP' : 'DOWN';
		el.vWan.classList.toggle('bad', !s.wanUp);

		if (el.ramKey)
			el.ramKey.textContent = s.memTotal ? `${fmtBytes(s.memUsed * 1)} / ${fmtBytes(s.memTotal)}` : '';

		this.drawCharts();

		if (procs !== undefined && el.procs) {
			const list = (procs || []).slice().sort((a, b) =>
				parseFloat(b['%CPU']) - parseFloat(a['%CPU']) || parseFloat(b['%MEM']) - parseFloat(a['%MEM'])).slice(0, 10);

			el.procs.innerHTML = list.length ? list.map(p =>
				`<tr class="tr"><td class="td">${esc(p.PID)}</td><td class="td">${esc(p.USER)}</td>` +
				`<td class="td gd-num">${esc(p['%CPU'])}</td><td class="td gd-num">${esc(p['%MEM'])}</td>` +
				`<td class="td gd-cmd">${esc(p.COMMAND)}</td></tr>`).join('')
				: `<tr class="tr placeholder"><td class="td" colspan="5">${esc(T.noproc)}</td></tr>`;
		}
	},

	drawCharts() {
		const el = this.el, h = this.s.h;
		if (!el || !el.cpu)
			return;

		lineChart(el.cpu, [
			{ data: h.cpu, cls: 'c-a', area: true },
			{ data: h.load.map(v => v * 100), cls: 'c-b' }
		], { max: 100, fmt: v => Math.round(v) + '%', ts: h.ts });

		lineChart(el.ram, [
			{ data: h.mem, cls: 'c-a', area: true }
		], { max: 100, fmt: v => Math.round(v) + '%', ts: h.ts, limit: 85 });

		barChart(el.traffic, h.rx, h.tx, { ts: h.ts });

		const cmax = Math.max(4, ...h.clients);
		lineChart(el.mini, [
			{ data: h.cpu, cls: 'c-a' },
			{ data: h.mem, cls: 'c-b' },
			{ data: h.clients.map(v => v / cmax * 100), cls: 'c-c' }
		], { max: 100, fmt: v => Math.round(v) + '', ts: [] });
	}
});
