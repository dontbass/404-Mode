'use strict';
'require view';
'require rpc';
'require uci';
'require poll';
'require ui';
'require neon-404mode as x';

/*
 * 404 Mode — dashboard ("Overview"): the cellular modem first, then the
 * proxy in use, the router itself, radio metrics and traffic.
 *
 * Data: QModem (ubus qmodem info / get_stats), Nikki + mihomo (ubus 404mode
 * proxy), system info, /proc/stat, thermal zone, the WAN device counters.
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const callSystemInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
const callRead = rpc.declare({ object: 'file', method: 'read', params: [ 'path' ], expect: { data: '' } });
const callCellInfo = rpc.declare({ object: 'qmodem', method: 'cell_info', params: [ 'config_section' ], expect: { '': {} } });
const callWrite = rpc.declare({ object: 'file', method: 'write', params: [ 'path', 'data', 'append', 'mode', 'base64' ] });
const LOGO_DIR = '/www/luci-static/resources/404mode-op/';
const callCell = rpc.declare({ object: '404mode', method: 'cell', params: [ 'mcc', 'mnc', 'lac', 'cid' ], expect: { '': {} } });

/* EARFCN (downlink) → LTE band, NR-ARFCN → NR band */
const LTE_BANDS = [ [ 1, 0, 599 ], [ 2, 600, 1199 ], [ 3, 1200, 1949 ], [ 4, 1950, 2399 ], [ 5, 2400, 2649 ], [ 7, 2750, 3449 ], [ 8, 3450, 3799 ],
	[ 12, 5010, 5179 ], [ 13, 5180, 5279 ], [ 17, 5730, 5849 ], [ 20, 6150, 6449 ], [ 25, 8040, 8689 ], [ 26, 8690, 9039 ], [ 28, 9210, 9659 ],
	[ 32, 9920, 10359 ], [ 38, 37750, 38249 ], [ 39, 38250, 38649 ], [ 40, 38650, 39649 ], [ 41, 39650, 41589 ], [ 42, 41590, 43589 ],
	[ 43, 43590, 45589 ], [ 66, 66436, 67335 ], [ 71, 68586, 68935 ] ];
const NR_BANDS = [ [ 78, 620000, 653333 ], [ 77, 653334, 680000 ], [ 79, 693334, 733333 ], [ 41, 499200, 537999 ], [ 28, 151600, 160600 ],
	[ 20, 158200, 164200 ], [ 8, 185000, 192000 ], [ 3, 361000, 376000 ], [ 1, 422000, 434000 ], [ 7, 524000, 538000 ] ];

function bandOf(arfcn, nr) {
	const n = parseInt(arfcn, 10);
	if (isNaN(n))
		return null;
	const hit = (nr || n > 100000 ? NR_BANDS : LTE_BANDS).find(b => n >= b[1] && n <= b[2]);
	return hit ? (nr || n > 100000 ? 'n' : 'B') + hit[0] : null;
}

/* operators as a monogram in their brand colour (not their logos) */
const OPCOLOR = [ [ /мегафон|megafon/i, '#00B956', '#fff' ], [ /мтс|mts/i, '#E30611', '#fff' ], [ /билайн|beeline/i, '#FFC800', '#111' ],
	[ /^t2$|tele2|т2/i, '#1F2229', '#fff' ], [ /yota/i, '#00AEEF', '#fff' ], [ /мотив|motiv/i, '#E4007C', '#fff' ],
	[ /ростелеком|rostelecom/i, '#7700FF', '#fff' ], [ /т-мобайл|t-mobile/i, '#FFDD2D', '#111' ], [ /летай|letai/i, '#00A651', '#fff' ],
	[ /kcell|activ/i, '#7B2A90', '#fff' ], [ /altel/i, '#E31E24', '#fff' ], [ /a1/i, '#DA291C', '#fff' ] ];

const callModemInfo = rpc.declare({ object: 'qmodem', method: 'info', params: [ 'config_section' ], expect: { '': {} } });
const callModemStats = rpc.declare({ object: 'qmodem', method: 'get_stats', params: [ 'config_section' ], expect: { '': {} } });
const callSimCaps = rpc.declare({ object: 'qmodem', method: 'get_sim_switch_capabilities', params: [ 'config_section' ], expect: { '': {} } });
const callSimSlot = rpc.declare({ object: 'qmodem', method: 'get_sim_slot', params: [ 'config_section' ], expect: { '': {} } });
const callSetSim = rpc.declare({ object: 'qmodem', method: 'set_sim_slot', params: [ 'config_section', 'slot' ], expect: { '': {} } });

const ICON_MAP = '<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>';
const ICON_REFRESH = '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20.5V16h-4.5"/>';
const ICON_CHEVRON = '<path d="m6 9 6 6 6-6"/>';

const T = (ru, en) => x.t(ru, en);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const QUOTA_KEY = '404mode.quota';

/* thresholds: [good, fair] */
const RF = {
	rsrp: { name: 'RSRP', unit: T('дБм', 'dBm'), lo: -140, hi: -44, q: [ -90, -105 ], hint: T('Мощность опорного сигнала', 'Reference signal power') },
	rsrq: { name: 'RSRQ', unit: T('дБ', 'dB'), lo: -20, hi: -3, q: [ -10, -15 ], hint: T('Качество приёма', 'Reception quality') },
	sinr: { name: 'SINR', unit: T('дБ', 'dB'), lo: -10, hi: 30, q: [ 13, 0 ], hint: T('Сигнал / шум', 'Signal to noise') },
	rssi: { name: 'RSSI', unit: T('дБм', 'dBm'), lo: -110, hi: -40, q: [ -65, -85 ], hint: T('Общий уровень', 'Total power') }
};

function quality(k, v) {
	if (v == null || isNaN(v))
		return 'none';
	return v >= RF[k].q[0] ? 'ok' : (v >= RF[k].q[1] ? 'warn' : 'bad');
}

function store(key, val) {
	try {
		if (val === undefined)
			return JSON.parse(localStorage.getItem(key) || 'null');
		localStorage.setItem(key, JSON.stringify(val));
	}
	catch (e) {}
	return null;
}

/* ---------- QModem output → one flat object ---------- */

function parseModem(list) {
	const m = { warn: null, bands: [] };
	const entries = Array.isArray(list) ? list : [];
	const find = (re, rat) => {
		let hit = null;
		for (const e of entries) {
			if (e.value == null || e.value === '' || !re.test(e.key || ''))
				continue;
			if (!rat || (e.extra_info || '') == rat)
				return e;
			hit = hit || e;
		}
		return hit;
	};
	const val = (re, rat) => { const e = find(re, rat); return e ? String(e.value).trim() : null; };
	const num = (re, rat) => { const v = parseFloat(val(re, rat)); return isNaN(v) ? null : v; };

	for (const e of entries)
		if (e.type == 'warning_message')
			m.warn = String(e.value || e.full_name || '').trim() || T('Модем не в сети', 'Modem offline');

	m.name = [ val(/^manufacturer$/i), val(/^name$/i) ].filter(Boolean).join(' ');
	m.isp = val(/^ISP$/i);
	m.plmn = (val(/^MCC$/i) || '') + (val(/^MNC$/i) || '');
	m.slot = val(/^SIM Slot$/i);
	m.number = val(/^SIM Number$/i);
	m.temp = num(/^temperature$/i);
	m.nettype = val(/^Network Type$/i) || '';
	m.mode = val(/^network_mode$/i) || '';

	const mode = (m.mode + ' ' + m.nettype).toUpperCase();
	const sa = /NR5G-SA|\bSA\b|NR SA|5G SA/.test(mode);
	const nsa = /EN-DC|NSA/.test(mode);
	const ca = entries.some(e => /\(CA\)/.test(e.key || '') || /^CA-/.test(e.extra_info || ''));
	const rat = sa ? 'NR' : 'LTE';

	m.rsrp = num(/^RSRP$/i, rat);
	m.rsrq = num(/^RSRQ$/i, rat);
	m.sinr = num(/^SINR$/i, rat);
	m.rssi = num(/^RSSI$/i, rat);
	m.cell = val(/^Cell ID$/i, rat);
	m.pci = val(/^Physical Cell ID$/i, rat);
	m.arfcn = val(/^E?ARFCN$/i, rat);
	m.tac = val(/^TAC$/i, rat);

	if (nsa) {
		m.nr = { rsrp: num(/^RSRP$/i, 'NR'), sinr: num(/^SINR$/i, 'NR') };
	}

	for (const e of entries) {
		if (!/^Band/i.test(e.key || '') || e.value == null || e.value === '')
			continue;
		const isNr = /NR/.test(e.extra_info || '') || /^n\d/i.test(e.value);
		let b = String(e.value).trim().replace(/^(LTE|NR)\s*/i, '');
		if (/^\d+$/.test(b))
			b = (isNr ? 'n' : 'B') + b;
		const bw = val(/^DL Bandwidth$/i, e.extra_info);
		if (!m.bands.some(x => x.band == b))
			m.bands.push({ band: b, nr: isNr, bw: bw, ca: /\(CA\)/.test(e.key) || /^CA-/.test(e.extra_info || '') });
	}

	/* modems that report only channel numbers: band from (E)ARFCN */
	if (!m.bands.length)
		for (const e of entries) {
			if (!/^(E?ARFCN)( \(CA\))?$/i.test(e.key || '') || e.value == null || e.value === '')
				continue;
			const isNr = /NR/.test(e.extra_info || '') || !/^EARFCN/i.test(e.key);
			const b = bandOf(String(e.value).split(/[\s\/]/)[0], isNr);
			if (b && !m.bands.some(x => x.band == b && !/\(CA\)/.test(e.key)))
				m.bands.push({ band: b, nr: isNr, bw: val(/^DL Bandwidth$/i, e.extra_info), ca: /\(CA\)/.test(e.key) });
		}

	if (sa)
		m.kind = '5G';
	else if (nsa)
		m.kind = '5G NSA';
	else if (/LTE/.test(mode) || m.rsrp != null)
		m.kind = (ca || m.bands.length > 1) ? '4G+' : 'LTE';
	else if (/WCDMA|UMTS|HSPA/.test(mode))
		m.kind = '3G';
	else
		m.kind = m.nettype || '—';

	m.modeText = sa ? T('5G SA, отдельная сеть', '5G standalone')
		: nsa ? T('LTE + 5G NR, режим EN-DC', 'LTE + 5G NR, EN-DC')
		: m.kind == '4G+' ? T('LTE-A, агрегация несущих', 'LTE-A, carrier aggregation')
		: m.kind == 'LTE' ? T('LTE, одна несущая', 'LTE, single carrier') : '';

	m.operator = x.operator(m.isp, m.plmn);

	return m;
}

function score(m) {
	if (m.rsrp == null)
		return null;
	const n = (v, lo, hi) => v == null ? .5 : clamp((v - lo) / (hi - lo), 0, 1);
	return Math.round((n(m.rsrp, -120, -75) * .45 + n(m.rsrq, -18, -6) * .25 + n(m.sinr, -3, 22) * .3) * 100);
}

/* ---------- small svg helpers ---------- */

const SVGNS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, kids) {
	const el = document.createElementNS(SVGNS, tag);
	for (const k in attrs || {})
		el.setAttribute(k, attrs[k]);
	(kids || []).forEach(c => el.appendChild(c));
	return el;
}

function arcLen(r, frac) { return 2 * Math.PI * r * frac; }

return view.extend({
	modems: [],

	load() {
		x.css();

		return L.resolveDefault(uci.load('qmodem'), null).then(() => {
			this.modems = [];
			uci.sections('qmodem', 'modem-device', s => {
				if (s.enabled !== '0')
					this.modems.push({ id: s['.name'], name: s.name || s['.name'] });
			});
			return null;
		});
	},

	/* ---------- render ---------- */

	render() {
		this.state = { cpu: null, net: null, dl: [], ul: [], win: 20, pings: [], modemIdx: 0 };

		const root = E('div', { 'class': 'xd' }, [
			E('h2', { 'name': 'content' }, [ T('Обзор', 'Overview') ]),
			E('div', { 'class': 'xd-grid' }, [
				this.renderModem(),
				this.renderProxy(),
				this.renderSystem(),
				this.renderRf(),
				this.renderTraffic()
			])
		]);

		this.root = root;

		poll.add(L.bind(this.tickFast, this), 3);
		poll.add(L.bind(this.tickModem, this), 6);
		poll.add(L.bind(this.tickProxy, this), 6);

		window.setTimeout(() => { this.tickFast(); this.tickModem(); this.tickProxy(); }, 0);
		window.addEventListener('resize', () => this.drawChart());

		return root;
	},

	q(sel) { return this.root.querySelector(sel); },

	renderModem() {
		const arcs = svg('g', { 'fill': 'none', 'stroke-linecap': 'round', 'transform': 'rotate(135 120 120)' });

		[ [ 104, 'rsrp' ], [ 80, 'rsrq' ], [ 56, 'sinr' ] ].forEach(([ r, k ]) => {
			const len = arcLen(r, .75), circ = arcLen(r, 1);
			arcs.appendChild(svg('circle', { 'cx': 120, 'cy': 120, 'r': r, 'class': 'xd-arc-bg', 'stroke-width': 10, 'stroke-dasharray': len.toFixed(1) + ' ' + circ.toFixed(1) }));
			arcs.appendChild(svg('circle', { 'cx': 120, 'cy': 120, 'r': r, 'class': 'xd-arc', 'data-arc': k, 'data-len': len.toFixed(1), 'data-circ': circ.toFixed(1), 'stroke': 'url(#xd-arc-g)', 'stroke-width': 10, 'stroke-dasharray': '0 ' + circ.toFixed(1) }));
		});

		const orbit = svg('svg', { 'viewBox': '0 0 240 240', 'class': 'xd-orbit-svg', 'aria-hidden': 'true' }, [
			svg('defs', {}, [
				svg('linearGradient', { 'id': 'xd-arc-g', 'x1': 0, 'y1': 1, 'x2': 1, 'y2': 0 }, [
					svg('stop', { 'offset': 0, 'class': 'xd-stop-a' }),
					svg('stop', { 'offset': 1, 'class': 'xd-stop-b' })
				])
			]),
			arcs,
			svg('circle', { 'cx': 120, 'cy': 120, 'r': 117, 'class': 'xd-sweep', 'fill': 'none', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-dasharray': '26 710' })
		]);

		const bars = E('div', { 'class': 'xd-bars', 'aria-hidden': 'true' }, [ 1, 2, 3, 4, 5 ].map(i => E('span', { 'style': 'height:' + (i * 20) + '%' })));

		return E('section', { 'class': 'xd-card xd-modem', 'data-search': 'модем оператор сигнал sim сим lte 5g 4g бэнд band modem operator signal' }, [
			E('div', { 'class': 'xd-modem-top' }, [
				E('div', { 'class': 'xd-seg', 'role': 'group', 'aria-label': T('SIM-карта', 'SIM card') }, [
					E('button', { 'type': 'button', 'class': 'xd-seg-btn', 'data-slot': '1', 'click': ev => this.switchSim(ev.currentTarget) }, [ 'SIM 1' ]),
					E('button', { 'type': 'button', 'class': 'xd-seg-btn', 'data-slot': '2', 'click': ev => this.switchSim(ev.currentTarget) }, [ 'SIM 2' ])
				]),
				E('span', { 'class': 'xd-net' }, [ '—' ]),
				E('span', { 'class': 'xd-net-mode' }, [ '' ]),
				E('span', { 'class': 'xd-online' }, [ E('i', { 'class': 'xd-dot' }), E('span', { 'class': 'xd-online-text' }, [ T('Ищем модем…', 'Looking for a modem…') ]) ])
			]),
			E('div', { 'class': 'xd-modem-body' }, [
				E('div', { 'class': 'xd-modem-main' }, [
					E('div', { 'class': 'xd-op-row' }, [
						E('button', { 'type': 'button', 'class': 'xd-op-badge', 'title': T('Свой логотип оператора: нажмите и выберите картинку', 'Your operator logo: click and pick an image'), 'click': ev => this.pickLogo(ev) }, [
							E('img', { 'class': 'xd-op-logo', 'alt': '', 'hidden': '' }),
							E('span', { 'class': 'xd-op-letter' })
						]),
						E('div', { 'class': 'xd-op' }, [ '…' ])
					]),
					E('div', { 'class': 'xd-op-meta' }, [ '' ]),
					E('div', { 'class': 'xd-signal' }, [
						bars,
						E('div', {}, [
							E('div', { 'class': 'xd-rsrp' }, [ E('span', { 'class': 'xd-rsrp-v' }, [ '—' ]), E('small', {}, [ ' ' + T('дБм', 'dBm') ]) ]),
							E('div', { 'class': 'xd-quality' }, [ '' ])
						])
					]),
					E('div', { 'class': 'xd-bands' })
				]),
				E('div', { 'class': 'xd-orbit' }, [
					orbit,
					E('div', { 'class': 'xd-orbit-c' }, [
						E('div', { 'class': 'xd-score' }, [ '—' ]),
						E('div', { 'class': 'xd-score-l' }, [ T('качество связи', 'link quality') ])
					]),
					E('div', { 'class': 'xd-orbit-legend' })
				])
			]),
			E('dl', { 'class': 'xd-cellinfo' }, [
				E('div', {}, [ E('dt', {}, [ 'Cell ID' ]), E('dd', { 'class': 'xd-cell' }, [
					E('span', { 'data-f': 'cell' }, [ '—' ]),
					E('a', { 'class': 'xd-map', 'hidden': '', 'href': '#', 'click': ev => this.showTower(ev), 'data-tip': T('Показать вышку на карте', 'Show the tower on a map'), 'aria-label': T('Показать вышку на карте', 'Show the tower on a map') }, [ x.icon(ICON_MAP) ])
				]) ]),
				E('div', {}, [ E('dt', {}, [ 'PCI' ]), E('dd', { 'data-f': 'pci' }, [ '—' ]) ]),
				E('div', {}, [ E('dt', {}, [ 'EARFCN' ]), E('dd', { 'data-f': 'arfcn' }, [ '—' ]) ]),
				E('div', {}, [ E('dt', {}, [ 'TAC' ]), E('dd', { 'data-f': 'tac' }, [ '—' ]) ])
			])
		]);
	},

	renderProxy() {
		const sw = x.switchEl(false, T('Прокси', 'Proxy'), (on, btn) => {
			btn.disabled = true;
			this.q('.xd-px-state').textContent = on ? T('Запускаем Nikki…', 'Starting Nikki…') : T('Останавливаем…', 'Stopping…');
			x.proxySet('service', { on: on }).then(() => window.setTimeout(() => { btn.disabled = false; this.tickProxy(); }, 2500));
		});

		return E('section', { 'class': 'xd-card xd-px', 'data-search': 'proxy прокси vpn nikki mihomo туннель пинг узел сервер' }, [
			E('div', { 'class': 'xd-px-top' }, [
				E('div', { 'class': 'xd-px-cap' }, [ T('Текущий прокси-сервер', 'Current proxy server') ]),
				sw
			]),
			E('div', { 'class': 'xd-px-pick' }, [
				E('button', { 'type': 'button', 'class': 'xd-px-node', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'click': ev => this.toggleNodeMenu(ev) }, [
					E('span', { 'class': 'xd-px-flag' }),
					E('span', { 'class': 'xd-px-txt' }, [
						E('b', {}, [ E('span', { 'class': 'xd-px-name' }, [ '—' ]), x.icon(ICON_CHEVRON, 'xd-px-chev') ]),
						E('small', { 'class': 'xd-px-via' }, [ '' ])
					])
				]),
				E('div', { 'class': 'xd-px-menu', 'role': 'listbox', 'hidden': '' })
			]),
			E('div', { 'class': 'xd-px-bottom' }, [
				E('div', {}, [
					E('div', { 'class': 'xd-px-ping' }, [
						E('span', { 'class': 'xd-px-ping-v' }, [ '—' ]), E('small', {}, [ ' ' + T('мс', 'ms') ]),
						E('button', { 'type': 'button', 'class': 'xd-refresh', 'title': T('Проверить пинг сейчас', 'Test the delay now'), 'aria-label': T('Проверить пинг', 'Test delay'), 'click': ev => this.refreshPing(ev.currentTarget) }, [ x.icon(ICON_REFRESH) ])
					]),
					E('div', { 'class': 'xd-px-state' }, [ T('Проверяем Nikki…', 'Checking Nikki…') ])
				]),
				svg('svg', { 'viewBox': '0 0 120 36', 'class': 'xd-spark', 'preserveAspectRatio': 'none', 'aria-hidden': 'true' }, [ svg('polyline', { 'points': '' }) ])
			])
		]);
	},

	renderSystem() {
		const meter = (k, label) => E('div', { 'class': 'xd-meter' }, [
			E('div', { 'class': 'xd-meter-row' }, [ E('span', {}, [ label ]), E('b', { 'data-m': k }, [ '—' ]) ]),
			E('div', { 'class': 'xd-track' }, [ E('i', { 'data-mbar': k }) ])
		]);

		return E('section', { 'class': 'xd-card xd-sys', 'data-search': 'система процессор память температура аптайм cpu ram uptime' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('h3', {}, [ T('Состояние системы', 'System') ]),
				E('span', { 'class': 'xd-muted xd-uptime' }, [ '' ])
			]),
			meter('cpu', T('Процессор', 'CPU')),
			meter('ram', T('Оперативная память', 'Memory')),
			E('div', { 'class': 'xd-temps' }, [
				E('div', { 'class': 'xd-tile' }, [ E('small', {}, [ T('Процессор', 'CPU') ]), E('b', { 'data-t': 'cpu' }, [ '—' ]) ]),
				E('div', { 'class': 'xd-tile' }, [ E('small', {}, [ T('Модем', 'Modem') ]), E('b', { 'data-t': 'modem' }, [ '—' ]) ])
			])
		]);
	},

	renderRf() {
		return E('section', { 'class': 'xd-card xd-rf', 'data-search': 'rsrp rsrq sinr rssi радиометрики сигнал band бэнд cell' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('h3', {}, [ T('Радиометрики', 'Radio metrics') ]),
				E('a', { 'class': 'xd-muted', 'href': L.url('admin/modem/qmodem') }, [ 'QModem' ])
			]),
			E('div', { 'class': 'xd-rf-grid' }, Object.keys(RF).map(k => E('div', { 'class': 'xd-tile xd-rf-tile', 'title': RF[k].hint, 'data-rf': k }, [
				E('div', { 'class': 'xd-rf-head' }, [ E('span', {}, [ RF[k].name ]), E('em', {}, [ '' ]) ]),
				E('div', { 'class': 'xd-rf-v' }, [ E('span', {}, [ '—' ]), E('small', {}, [ ' ' + RF[k].unit ]) ]),
				E('div', { 'class': 'xd-track xd-track-s' }, [ E('i') ])
			]))),
			E('dl', { 'class': 'xd-rf-foot' }, [
				E('div', {}, [ E('dt', {}, [ T('Бэнд', 'Band') ]), E('dd', { 'data-f': 'bands' }, [ '—' ]) ]),
				E('div', {}, [ E('dt', {}, [ 'Cell ID' ]), E('dd', { 'data-f': 'cell2' }, [ '—' ]) ]),
				E('div', {}, [ E('dt', {}, [ 'PCI' ]), E('dd', { 'data-f': 'pci2' }, [ '—' ]) ])
			])
		]);
	},

	renderTraffic() {
		const r = 72, circ = (2 * Math.PI * r).toFixed(1);
		const ring = svg('svg', { 'viewBox': '0 0 170 170', 'class': 'xd-ring-svg', 'aria-hidden': 'true' }, [
			svg('circle', { 'cx': 85, 'cy': 85, 'r': r, 'class': 'xd-arc-bg', 'fill': 'none', 'stroke-width': 12 }),
			svg('circle', { 'cx': 85, 'cy': 85, 'r': r, 'class': 'xd-quota-arc', 'fill': 'none', 'stroke': 'url(#xd-arc-g)', 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-dasharray': '0 ' + circ, 'data-circ': circ })
		]);

		const win = (n, label) => E('button', { 'type': 'button', 'class': 'xd-seg-btn', 'data-win': n, 'aria-pressed': n == 20 ? 'true' : 'false', 'click': ev => {
			this.state.win = n;
			this.root.querySelectorAll('[data-win]').forEach(b => b.setAttribute('aria-pressed', b === ev.currentTarget ? 'true' : 'false'));
			this.drawChart();
		} }, [ label ]);

		return E('section', { 'class': 'xd-card xd-traffic', 'data-search': 'трафик лимит тариф скорость скачивание загрузка traffic quota speed' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('h3', {}, [ T('Трафик', 'Traffic') ]),
				E('div', { 'class': 'xd-seg xd-seg-s' }, [ win(20, T('1 мин', '1 min')), win(100, T('5 мин', '5 min')) ])
			]),
			E('div', { 'class': 'xd-traffic-body' }, [
				E('div', { 'class': 'xd-ring' }, [
					ring,
					E('div', { 'class': 'xd-ring-c' }, [
						E('b', { 'class': 'xd-quota-used' }, [ '—' ]),
						E('small', { 'class': 'xd-quota-of' }, [ '' ]),
						E('button', { 'type': 'button', 'class': 'xd-link xd-quota-edit', 'click': () => this.editQuota() }, [ T('Задать лимит', 'Set a limit') ])
					])
				]),
				E('div', { 'class': 'xd-speed' }, [
					E('div', { 'class': 'xd-speed-now' }, [
						E('div', {}, [ E('span', { 'class': 'xd-key xd-key-dl' }, [ T('Скачивание', 'Download') ]), E('div', { 'class': 'xd-big' }, [ E('span', { 'data-s': 'dl' }, [ '—' ]), E('small', { 'data-u': 'dl' }, [ '' ]) ]) ]),
						E('div', {}, [ E('span', { 'class': 'xd-key xd-key-ul' }, [ T('Загрузка', 'Upload') ]), E('div', { 'class': 'xd-big' }, [ E('span', { 'data-s': 'ul' }, [ '—' ]), E('small', { 'data-u': 'ul' }, [ '' ]) ]) ])
					]),
					E('canvas', { 'class': 'xd-chart', 'aria-label': T('График скорости', 'Speed chart') }),
					E('div', { 'class': 'xd-muted xd-wan' }, [ '' ])
				])
			])
		]);
	},

	/* ---------- quota ---------- */

	editQuota() {
		const q = store(QUOTA_KEY) || {};
		const box = this.q('.xd-ring-c');
		const input = E('input', { 'type': 'number', 'min': '1', 'step': '1', 'value': q.limit || '', 'placeholder': T('ГБ', 'GB'), 'aria-label': T('Лимит тарифа, ГБ', 'Plan limit, GB') });
		const save = () => {
			const v = parseFloat(input.value);
			store(QUOTA_KEY, v > 0 ? { limit: v } : {});
			form.remove();
			box.hidden = false;
			this.paintQuota();
		};
		const form = E('div', { 'class': 'xd-quota-form' }, [
			E('label', {}, [ T('Лимит тарифа, ГБ', 'Plan limit, GB') ]),
			input,
			E('div', { 'class': 'xd-quota-actions' }, [
				E('button', { 'type': 'button', 'class': 'btn cbi-button important', 'click': save }, [ T('Сохранить', 'Save') ]),
				E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': () => { form.remove(); box.hidden = false; } }, [ T('Отмена', 'Cancel') ])
			])
		]);

		input.addEventListener('keydown', ev => { if (ev.key == 'Enter') save(); });
		box.hidden = true;
		box.parentNode.appendChild(form);
		input.focus();
	},

	paintQuota() {
		const used = this.state.used;
		const q = store(QUOTA_KEY) || {};
		const arc = this.q('.xd-quota-arc');
		const circ = +arc.getAttribute('data-circ');

		if (used == null)
			return;

		const gb = used / 1073741824;
		this.q('.xd-quota-used').textContent = gb >= 100 ? x.num(gb, 0) : x.num(gb, 1);

		if (q.limit) {
			const frac = clamp(gb / q.limit, 0, 1);
			arc.setAttribute('stroke-dasharray', (frac * circ).toFixed(1) + ' ' + circ);
			arc.classList.toggle('xd-quota-over', frac > .9);
			this.q('.xd-quota-of').textContent = T('из ' + x.num(q.limit, 0) + ' ГБ', 'of ' + x.num(q.limit, 0) + ' GB');
			this.q('.xd-quota-edit').textContent = T('Изменить', 'Change');
		}
		else {
			arc.setAttribute('stroke-dasharray', '0 ' + circ);
			this.q('.xd-quota-of').textContent = T('ГБ ', 'GB ') + (this.state.usedSince == 'stats' ? T('за период', 'this period') : T('с загрузки', 'since boot'));
			this.q('.xd-quota-edit').textContent = T('Задать лимит', 'Set a limit');
		}
	},

	/* ---------- polling ---------- */

	tickFast() {
		return Promise.all([
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callRead('/proc/stat'), ''),
			L.resolveDefault(callRead('/sys/class/thermal/thermal_zone0/temp'), ''),
			L.resolveDefault(callIfaces(), []),
			L.resolveDefault(callDevices(), {})
		]).then(([ info, stat, temp, ifaces, devs ]) => {
			this.paintSystem(info, stat, temp);
			this.paintTraffic(ifaces, devs);
		});
	},

	paintSystem(info, stat, temp) {
		const s = this.state;
		const line = (stat || '').split('\n')[0];

		if (/^cpu\s/.test(line)) {
			const v = line.trim().split(/\s+/).slice(1).map(Number);
			const idle = v[3] + (v[4] || 0), total = v.reduce((a, b) => a + b, 0);
			if (s.cpu) {
				const dt = total - s.cpu.total;
				s.cpuPct = dt > 0 ? clamp(Math.round(100 * (1 - (idle - s.cpu.idle) / dt)), 0, 100) : s.cpuPct;
			}
			s.cpu = { idle: idle, total: total };
		}

		if (s.cpuPct == null && info.load)
			s.cpuPct = Math.round(Math.min(100, info.load[0] / 65536 * 100));

		const set = (k, txt, pct) => {
			this.q('[data-m="' + k + '"]').textContent = txt;
			const bar = this.q('[data-mbar="' + k + '"]');
			bar.style.width = clamp(pct, 0, 100) + '%';
			bar.className = pct > 90 ? 'bad' : (pct > 75 ? 'warn' : '');
		};

		if (s.cpuPct != null)
			set('cpu', s.cpuPct + '%', s.cpuPct);

		if (info.memory) {
			const mem = info.memory;
			const avail = mem.available || ((mem.free || 0) + (mem.buffered || 0) + (mem.cached || 0));
			const usedMb = Math.round((mem.total - avail) / 1048576), totalMb = Math.round(mem.total / 1048576);
			set('ram', usedMb + ' / ' + totalMb + ' ' + T('МБ', 'MB'), (mem.total - avail) / mem.total * 100);
		}

		const t = parseInt(temp, 10);
		if (!isNaN(t))
			this.paintTemp('cpu', t > 1000 ? t / 1000 : t);

		if (info.uptime)
			this.q('.xd-uptime').textContent = T('аптайм ', 'uptime ') + x.duration(info.uptime);
	},

	paintTemp(k, v) {
		const el = this.q('[data-t="' + k + '"]');
		if (v == null || isNaN(v)) {
			el.textContent = '—';
			return;
		}
		el.textContent = Math.round(v) + '°';
		el.className = v >= 85 ? 'bad' : (v >= 70 ? 'warn' : '');
	},

	paintTraffic(ifaces, devs) {
		const s = this.state;
		let wan = null;

		for (const i of ifaces || []) {
			if (!i.up || !Array.isArray(i.route))
				continue;
			if (i.route.some(r => r.target == '0.0.0.0' && r.mask == 0)) {
				wan = { iface: i.interface, dev: i.l3_device || i.device };
				break;
			}
		}

		const st = wan && devs && devs[wan.dev] && devs[wan.dev].stats;
		if (!st) {
			this.q('.xd-wan').textContent = T('Нет маршрута в интернет', 'No default route');
			return;
		}

		const now = Date.now(), rx = +st.rx_bytes || 0, tx = +st.tx_bytes || 0;
		this.q('.xd-wan').textContent = T('через ', 'via ') + wan.iface + ' (' + wan.dev + ')';

		if (s.net && s.net.dev == wan.dev && now > s.net.t) {
			const dt = (now - s.net.t) / 1000;
			const dl = Math.max(0, (rx - s.net.rx) / dt), ul = Math.max(0, (tx - s.net.tx) / dt);
			s.dl.push(dl); s.ul.push(ul);
			if (s.dl.length > 100) { s.dl.shift(); s.ul.shift(); }
			const [ dv, du ] = x.rate(dl), [ uv, uu ] = x.rate(ul);
			this.q('[data-s="dl"]').textContent = dv; this.q('[data-u="dl"]').textContent = ' ' + du;
			this.q('[data-s="ul"]').textContent = uv; this.q('[data-u="ul"]').textContent = ' ' + uu;
			this.drawChart();
		}

		s.net = { dev: wan.dev, rx: rx, tx: tx, t: now };

		if (s.usedSince != 'stats') {
			s.used = rx + tx;
			s.usedSince = 'boot';
			this.paintQuota();
		}
	},

	drawChart() {
		const c = this.q('.xd-chart');
		const s = this.state;
		if (!c || !c.getContext)
			return;

		const r = c.getBoundingClientRect();
		if (!r.width)
			return;

		const dpr = window.devicePixelRatio || 1;
		c.width = Math.round(r.width * dpr);
		c.height = Math.round(r.height * dpr);

		const ctx = c.getContext('2d');
		const cs = getComputedStyle(this.root);
		const colA = cs.getPropertyValue('--xd-a').trim() || '#2BE4FF';
		const colB = cs.getPropertyValue('--xd-b').trim() || '#4C7DFF';
		const grid = cs.getPropertyValue('--xd-grid').trim() || 'rgba(135,150,168,.1)';
		const W = c.width, H = c.height, n = s.win;
		const dl = s.dl.slice(-n), ul = s.ul.slice(-n);
		const max = Math.max(1, ...dl, ...ul) * 1.15;

		ctx.clearRect(0, 0, W, H);
		ctx.strokeStyle = grid;
		ctx.lineWidth = 1;
		for (let i = 1; i < 4; i++) {
			const y = Math.round(H / 4 * i) + .5;
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
		}

		const series = (data, color, fill) => {
			if (data.length < 2)
				return;
			const step = W / (n - 1), off = (n - data.length) * step;
			ctx.beginPath();
			data.forEach((v, i) => {
				const px = off + i * step, py = H - (v / max) * (H * .9) - 2 * dpr;
				i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
			});
			ctx.strokeStyle = color;
			ctx.lineWidth = 2 * dpr;
			ctx.lineJoin = 'round';
			ctx.stroke();
			ctx.lineTo(off + (data.length - 1) * step, H);
			ctx.lineTo(off, H);
			ctx.closePath();
			const g = ctx.createLinearGradient(0, 0, 0, H);
			g.addColorStop(0, fill);
			g.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = g;
			ctx.fill();
		};

		series(dl, colA, colA + '38');
		series(ul, colB, colB + '2e');
	},

	tickModem() {
		const m = this.modems[this.state.modemIdx];

		if (!m) {
			this.paintModem(null);
			return Promise.resolve();
		}

		if (!this.state.simChecked) {
			this.state.simChecked = true;
			Promise.all([ L.resolveDefault(callSimCaps(m.id), null), L.resolveDefault(callSimSlot(m.id), null) ]).then(([ caps, slot ]) => {
				const slots = caps && Array.isArray(caps.simSlots) ? caps.simSlots.map(String) : [];
				this.state.sim = { ok: !!caps && caps.supportSwitch === '1' && slots.length > 1, slots: slots, cur: slot && slot.sim_slot != null ? String(slot.sim_slot) : null, note: caps && caps.ExtraInfo };
				this.paintSim();
			});
		}

		if (this.state.switching)
			return Promise.resolve();

		return Promise.all([
			L.resolveDefault(callModemInfo(m.id), {}),
			this.state.statsChecked ? Promise.resolve(null) : L.resolveDefault(callModemStats(m.id), null),
			L.resolveDefault(callCellInfo(m.id), {})
		]).then(([ res, stats, cell ]) => {
			/* "info" skips the cell part while QModem is not dialing itself
			   (another app holds the data call): take it from cell_info */
			const list = (res && res.modem_info) || [];
			const have = {};
			list.forEach(e => have[e.key + '|' + (e.extra_info || '')] = true);
			((cell && cell.modem_info) || []).forEach(e => { if (!have[e.key + '|' + (e.extra_info || '')]) list.push(e); });
			res = { modem_info: list };
			if (stats) {
				this.state.statsChecked = true;
				if (stats.available) {
					this.state.usedSince = 'stats';
					this.state.used = (+stats.total_rx_bytes || 0) + (+stats.total_tx_bytes || 0);
					this.paintQuota();
				}
			}
			this.paintModem(parseModem(res && res.modem_info), m);
		});
	},

	paintModem(m, section) {
		const card = this.q('.xd-modem');

		if (!m) {
			card.classList.add('xd-empty');
			this.q('.xd-op').textContent = T('Модем не найден', 'No modem found');
			this.q('.xd-op-meta').textContent = T('Сведения о сотовой связи берутся из QModem. Если модем подключён, проверьте раздел «Модем».', 'Cellular data comes from QModem. If a modem is attached, check the Modem section.');
			this.q('.xd-online-text').textContent = T('нет данных', 'no data');
			this.q('.xd-online').className = 'xd-online off';
			return;
		}

		card.classList.remove('xd-empty');

		const sc = score(m);
		const cls = quality('rsrp', m.rsrp);

		this.q('.xd-op').textContent = m.operator || (m.warn ? T('Нет сети', 'No network') : '—');
		this.q('.xd-op').style.setProperty('--len', Math.max(4, (this.q('.xd-op').textContent || '').length));
		const badge = this.q('.xd-op-badge');
		const brand = OPCOLOR.find(b => b[0].test(m.operator || ''));
		badge.hidden = !m.operator;
		badge.querySelector('.xd-op-letter').textContent = (m.operator || '').replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').slice(0, 1).toUpperCase();
		this.loadLogo(m.plmn);
		badge.style.setProperty('--op', brand ? brand[1] : 'var(--xd-a)');
		badge.style.setProperty('--op-ink', brand ? brand[2] : '#04121A');
		this.q('.xd-op-meta').textContent = [
			m.plmn ? 'PLMN ' + m.plmn : null,
			m.name || (section && section.name)
		].filter(Boolean).join(', ');

		const net = this.q('.xd-net');
		net.textContent = m.kind;
		net.className = 'xd-net' + (/5G/.test(m.kind) ? ' xd-net-5g' : '');
		this.q('.xd-net-mode').textContent = m.warn || m.modeText;

		const online = this.q('.xd-online');
		online.className = 'xd-online' + (m.warn ? ' off' : '');
		this.q('.xd-online-text').textContent = m.warn ? T('нет регистрации', 'not registered') : (m.number || T('в сети', 'online'));

		this.state.infoSlot = m.slot != null ? String(+m.slot === 0 ? 1 : +m.slot) : null;
		this.paintSim();

		/* the serving tower: looked up on click (open cell database) */
		this.state.cellRef = m;
		this.q('.xd-map').hidden = !(/^\d{5,6}$/.test(m.plmn || '') && m.cell);

		this.q('.xd-rsrp-v').textContent = m.rsrp != null ? x.minus(m.rsrp) : '—';
		const qtxt = { ok: T('Хороший сигнал', 'Good signal'), warn: T('Средний сигнал', 'Fair signal'), bad: T('Слабый сигнал', 'Weak signal'), none: '' };
		const qel = this.q('.xd-quality');
		qel.textContent = qtxt[cls];
		qel.className = 'xd-quality xd-' + cls;

		const lit = m.rsrp == null ? 0 : clamp(Math.round((m.rsrp + 125) / 10), 1, 5);
		this.root.querySelectorAll('.xd-bars span').forEach((b, i) => b.className = i < lit ? 'on xd-' + cls : '');

		this.q('.xd-score').textContent = sc == null ? '—' : sc;

		const frac = { rsrp: (m.rsrp + 125) / 50, rsrq: (m.rsrq + 20) / 16, sinr: (m.sinr + 5) / 30 };
		this.root.querySelectorAll('[data-arc]').forEach(a => {
			const k = a.getAttribute('data-arc'), v = m[k];
			const f = v == null ? 0 : clamp(frac[k], .02, 1);
			a.setAttribute('stroke-dasharray', (f * +a.getAttribute('data-len')).toFixed(1) + ' ' + a.getAttribute('data-circ'));
		});

		const legend = this.q('.xd-orbit-legend');
		legend.innerHTML = '';
		[ 'rsrp', 'rsrq', 'sinr' ].forEach(k => legend.appendChild(E('div', {}, [
			E('small', {}, [ RF[k].name ]),
			E('b', { 'class': 'xd-' + quality(k, m[k]) }, [ m[k] != null ? x.minus(m[k]) : '—' ])
		])));

		const bands = this.q('.xd-bands');
		bands.innerHTML = '';
		m.bands.forEach((b, i) => bands.appendChild(E('span', { 'class': 'xd-band' }, [
			E('b', {}, [ b.band ]),
			b.bw ? E('span', {}, [ String(b.bw).replace(/\s*MHz/i, '') + ' ' + T('МГц', 'MHz') ]) : '',
			E('small', {}, [ i == 0 ? T('основная', 'primary') : (b.nr && !m.bands[0].nr ? '5G NR' : T('доп.', 'secondary')) ])
		])));

		const f = (k, v) => this.root.querySelectorAll('[data-f="' + k + '"]').forEach(el => el.textContent = v != null && v !== '' ? v : '—');
		f('cell', m.cell); f('pci', m.pci); f('arfcn', m.arfcn); f('tac', m.tac);
		f('cell2', m.cell); f('pci2', m.pci);
		f('bands', m.bands.length ? m.bands.map(b => b.band).join(' + ') + (m.bands.length > 1 ? T(' (агрегация активна)', ' (aggregation on)') : '') : null);

		Object.keys(RF).forEach(k => {
			const tile = this.q('[data-rf="' + k + '"]');
			const v = m[k], c = quality(k, v);
			const word = { ok: T('отлично', 'good'), warn: T('средне', 'fair'), bad: T('слабо', 'weak'), none: '' };
			tile.querySelector('em').textContent = word[c];
			tile.querySelector('em').className = 'xd-' + c;
			tile.querySelector('.xd-rf-v span').textContent = v != null ? x.minus(v) : '—';
			const bar = tile.querySelector('.xd-track i');
			bar.style.width = (v == null ? 0 : clamp((v - RF[k].lo) / (RF[k].hi - RF[k].lo) * 100, 3, 100)) + '%';
			bar.className = 'xd-bg-' + c;
		});

		this.paintTemp('modem', m.temp);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	/* ---------- operator logo: an image the owner puts on the router ----------
	   Stored as /www/luci-static/resources/404mode-op/<PLMN>.png, never shipped
	   with the theme (logos are the operators' trademarks). */

	loadLogo(plmn, force) {
		if (!/^\d{5,6}$/.test(plmn || '') || (this.state.logoFor == plmn && !force))
			return;
		this.state.logoFor = plmn;
		const badge = this.q('.xd-op-badge'), img = badge.querySelector('.xd-op-logo');
		img.onload = () => { img.hidden = false; badge.classList.add('has-logo'); };
		img.onerror = () => { img.hidden = true; badge.classList.remove('has-logo'); };
		img.src = L.resource('404mode-op/' + plmn + '.png') + '?t=' + (force ? Date.now() : '1');
	},

	pickLogo(ev) {
		const m = this.state.cellRef;
		const plmn = m && m.plmn;
		if (!/^\d{5,6}$/.test(plmn || ''))
			return;

		const input = E('input', { 'type': 'file', 'accept': 'image/png,image/jpeg,image/svg+xml,image/webp' });
		input.addEventListener('change', () => {
			const f = input.files && input.files[0];
			if (!f)
				return;
			const url = URL.createObjectURL(f);
			const pic = new Image();
			pic.onload = () => {
				/* square, 192 px PNG: small enough for one rpc call */
				const size = 192, c = document.createElement('canvas');
				c.width = c.height = size;
				const k = Math.min(size / pic.naturalWidth || 1, size / pic.naturalHeight || 1);
				const w = (pic.naturalWidth || size) * k, h = (pic.naturalHeight || size) * k;
				c.getContext('2d').drawImage(pic, (size - w) / 2, (size - h) / 2, w, h);
				URL.revokeObjectURL(url);
				const data = c.toDataURL('image/png').split(',')[1];
				callWrite(LOGO_DIR + plmn + '.png', data, false, 420, true).then(() => {
					this.loadLogo(plmn, true);
					ui.addNotification(null, E('p', {}, [ T('Логотип сохранён на роутере.', 'Logo saved on the router.') ]), 'info');
				}).catch(e => ui.addNotification(null, E('p', {}, [ T('Не удалось сохранить логотип: ', 'Could not save the logo: ') + (e.message || e) ]), 'danger'));
			};
			pic.onerror = () => ui.addNotification(null, E('p', {}, [ T('Этот файл не открылся как картинка.', 'This file is not an image.') ]), 'warning');
			pic.src = url;
		});
		input.click();
	},

	/* ---------- tower on a map ---------- */

	showTower(ev) {
		ev.preventDefault();
		const m = this.state.cellRef;
		if (!m || !m.cell)
			return;

		const mcc = m.plmn.slice(0, 3), mnc = m.plmn.slice(3);
		const cid = parseInt(m.cell, /^[0-9]+$/.test(m.cell) && !/[A-F]/i.test(m.cell) && m.cell.length > 7 ? 10 : 16);
		const enb = cid >> 8;
		const lacs = [];
		if (m.tac) {
			if (/^[0-9A-F]+$/i.test(m.tac)) lacs.push(String(parseInt(m.tac, 16)));
			if (/^[0-9]+$/.test(m.tac)) lacs.push(String(parseInt(m.tac, 10)));
		}

		const a = ev.currentTarget;
		const w = window.open('about:blank', '_blank');
		a.classList.add('busy');

		L.resolveDefault(callCell(mcc, mnc, lacs.filter((v, i) => lacs.indexOf(v) == i), String(cid)), {}).then(r => {
			a.classList.remove('busy');
			if (r && r.found) {
				const url = 'https://yandex.ru/maps/?pt=' + r.lon + ',' + r.lat + '&z=15&l=map';
				if (w) w.location = url; else window.open(url, '_blank');
				return;
			}
			const net = 'https://www.cellmapper.net/map?MCC=' + mcc + '&MNC=' + (+mnc) + '&type=' + (/5G/.test(m.kind) && !/NSA/.test(m.kind) ? 'NR' : 'LTE');
			if (w) w.location = net;
			try { navigator.clipboard.writeText(String(enb)); } catch (e) {}
			ui.addNotification(null, E('p', {}, [ r && r.offline
				? T('Роутер не достучался до базы вышек. ', 'The router could not reach the tower database. ')
				: T('Вышки нет в открытой базе. ', 'The tower is not in the open database. '),
				T('Открыл CellMapper по сети оператора, номер eNB ' + enb + ' скопирован: вставьте его в поиск карты.', 'CellMapper is open on the operator network, eNB ' + enb + ' is copied: paste it into the map search.') ]), 'info');
		});
	},

	/* ---------- SIM slot ---------- */

	paintSim() {
		const sim = this.state.sim || {};
		const cur = this.state.switching || sim.cur || this.state.infoSlot;
		this.root.querySelectorAll('.xd-modem [data-slot]').forEach(b => {
			const slot = b.getAttribute('data-slot');
			b.setAttribute('aria-current', cur == slot ? 'true' : 'false');
			b.disabled = !!this.state.switching || (cur != slot && !sim.ok);
			b.title = sim.ok ? (cur == slot ? T('Активная SIM-карта', 'Active SIM') : T('Переключиться на SIM ', 'Switch to SIM ') + slot)
				: T('Модем не поддерживает переключение SIM', 'This modem cannot switch SIM slots');
		});
	},

	switchSim(btn) {
		const sim = this.state.sim || {};
		const slot = btn.getAttribute('data-slot');
		const m = this.modems[this.state.modemIdx];
		if (!m || !sim.ok || slot == (sim.cur || this.state.infoSlot) || this.state.switching)
			return;

		const card = this.q('.xd-modem');
		this.state.switching = slot;
		card.classList.add('xd-switching');
		card.setAttribute('data-switch', T('Переключаем на SIM ', 'Switching to SIM ') + slot + '…');
		this.paintSim();

		const min = new Promise(r => window.setTimeout(r, 1500));
		Promise.all([ L.resolveDefault(callSetSim(m.id, slot), null), min ]).then(([ res ]) => {
			const ok = res && res.success;
			sim.cur = ok ? slot : sim.cur;
			ui.addNotification(null, E('p', {}, [ ok ? T('Активна SIM ' + slot + '. Модем переподключается к сети.', 'SIM ' + slot + ' is active. The modem is reconnecting.') : T('Модем не переключил слот. Проверьте, вставлена ли SIM ' + slot + '.', 'The modem did not switch. Is SIM ' + slot + ' inserted?') ]), ok ? 'info' : 'warning');
		}).then(() => {
			this.state.switching = null;
			card.classList.remove('xd-switching');
			this.paintSim();
			return this.tickModem();
		});
	},

	/* ---------- proxy picker and delay ---------- */

	toggleNodeMenu(ev) {
		const p = this.state.proxy;
		const btn = ev.currentTarget;
		const menu = this.q('.xd-px-menu');
		const open = menu.hidden;

		const close = () => {
			menu.hidden = true;
			btn.setAttribute('aria-expanded', 'false');
			document.removeEventListener('click', this.state.menuOff, true);
		};

		if (!open || !p || !p.api) {
			if (!p || !p.api) location.href = L.url('admin/proxy');
			return close();
		}

		const group = (p.groups || []).find(g => g.name == p.main);
		if (!group)
			return;

		menu.innerHTML = '';
		menu.appendChild(E('div', { 'class': 'xd-px-menu-h' }, [ T('Группа ', 'Group ') + x.nodeName(group.name) ]));
		group.all.forEach(n => {
			const sub = n.group ? (p.groups || []).find(g => g.name == n.name) : null;
			menu.appendChild(E('button', {
				'type': 'button',
				'class': 'xd-px-opt' + (group.now == n.name ? ' active' : ''),
				'role': 'option',
				'aria-selected': group.now == n.name ? 'true' : 'false',
				'click': () => {
					close();
					if (group.now == n.name) return;
					this.q('.xd-px-name').textContent = x.nodeName(n.name);
					x.proxySet('select', { group: group.name, name: n.name }).then(() => this.tickProxy());
				}
			}, [
				n.group ? x.icon('<path d="M4 7h16M4 12h16M4 17h10"/>', 'xp-gi') : x.flag(n.name, 'xf-s'),
				E('span', { 'class': 'xd-px-opt-n' }, [ x.nodeName(n.name), sub && sub.now ? E('small', {}, [ ' › ' + x.nodeName(sub.now) ]) : '' ]),
				E('span', { 'class': 'xd-px-opt-d xd-' + x.delayClass(n.delay) }, [ n.delay ? n.delay + ' ' + T('мс', 'ms') : '' ])
			]));
		});

		/* nodes of the group the main selector points at: pick (pin) one */
		const subName = (group.all.find(n => n.name == group.now && n.group) || {}).name;
		const sub = subName ? (p.groups || []).find(g => g.name == subName) : null;
		const leaves = sub ? sub.all.filter(n => !n.group) : [];

		if (leaves.length) {
			const list = E('div', { 'class': 'xd-px-list' });
			const filterIn = E('input', { 'type': 'search', 'class': 'xd-px-filter', 'placeholder': T('Найти узел', 'Find a node'), 'aria-label': T('Найти узел', 'Find a node') });
			const fill = () => {
				const q = filterIn.value.trim().toLowerCase();
				list.innerHTML = '';
				leaves.filter(n => !q || n.name.toLowerCase().indexOf(q) > -1).sort((a, b) => (b.delay > 0) - (a.delay > 0) || (a.delay || 1e9) - (b.delay || 1e9)).forEach(n => {
					list.appendChild(E('button', {
						'type': 'button',
						'class': 'xd-px-opt' + (sub.now == n.name ? ' active' : ''),
						'role': 'option',
						'aria-selected': sub.now == n.name ? 'true' : 'false',
						'click': () => {
							close();
							this.q('.xd-px-name').textContent = x.nodeName(n.name);
							x.proxySet('select', { group: sub.name, name: n.name }).then(() => this.tickProxy());
						}
					}, [
						x.flag(n.name, 'xf-s'),
						E('span', { 'class': 'xd-px-opt-n' }, [ x.nodeName(n.name) ]),
						E('span', { 'class': 'xd-px-opt-d xd-' + x.delayClass(n.delay) }, [ n.delay ? n.delay + ' ' + T('мс', 'ms') : (n.delay === 0 ? T('нет', 'n/a') : '') ])
					]));
				});
			};
			filterIn.addEventListener('input', fill);
			menu.appendChild(E('div', { 'class': 'xd-px-menu-h xd-px-menu-sub' }, [
				T('Узлы группы ', 'Nodes of ') + x.nodeName(sub.name) + (sub.fixed ? T(', закреплён вручную', ', pinned') : T(', выбор автоматический', ', automatic'))
			]));
			if (leaves.length > 8)
				menu.appendChild(filterIn);
			menu.appendChild(list);
			fill();
		}

		menu.hidden = false;
		btn.setAttribute('aria-expanded', 'true');
		this.state.menuOff = e => { if (!e.target.closest('.xd-px-pick')) close(); };
		window.setTimeout(() => document.addEventListener('click', this.state.menuOff, true), 0);
	},

	refreshPing(btn) {
		const p = this.state.proxy;
		const node = p && p.node;
		if (!node || btn.classList.contains('spin'))
			return;

		btn.classList.add('spin');
		const min = new Promise(r => window.setTimeout(r, 1000));
		Promise.all([ L.resolveDefault(x.proxySet('delay', { name: node.name }), null), min ]).then(([ r ]) => {
			btn.classList.remove('spin');
			const d = r && r.delay;
			const v = this.q('.xd-px-ping-v');
			v.textContent = d ? d : T('нет', 'n/a');
			v.className = 'xd-px-ping-v xd-' + x.delayClass(d);
			if (d) {
				this.state.pings.push(d);
				if (this.state.pings.length > 30) this.state.pings.shift();
			}
		});
	},

	tickProxy() {
		return x.proxy().then(p => this.paintProxy(p));
	},

	paintProxy(p) {
		this.state.proxy = p;
		const card = this.q('.xd-px');
		const sw = card.querySelector('.xs');
		const state = this.q('.xd-px-state');
		const flag = this.q('.xd-px-flag');

		card.classList.toggle('xd-empty', !p.installed);

		if (!p.installed) {
			sw.hidden = true;
			this.q('.xd-px-name').textContent = T('Nikki не установлен', 'Nikki is not installed');
			this.q('.xd-px-via').textContent = T('Панель прокси работает через Nikki и mihomo', 'The proxy panel works with Nikki and mihomo');
			state.textContent = '';
			return;
		}

		if (!sw.disabled)
			sw.setAttribute('aria-checked', p.running ? 'true' : 'false');

		const node = p.node;
		const leafName = node ? node.name : (p.running && p.chain && p.chain.length ? p.chain[p.chain.length - 1] : '');
		flag.innerHTML = '';
		flag.appendChild(x.flag(leafName, 'xf-l'));

		this.q('.xd-px-name').textContent = leafName ? x.nodeName(leafName) : (p.running ? '—' : T('Прокси выключен', 'Proxy is off'));
		this.q('.xd-px-via').textContent = node ? [ node.type, (p.chain || []).slice(0, -1).map(x.nodeName).join(' › ') ].filter(Boolean).join(T(', группа ', ', group ')) : (p.running ? '' : T('Трафик идёт напрямую', 'Traffic goes direct'));

		const d = node ? node.delay : null;
		if (!this.q('.xd-refresh').classList.contains('spin')) {
			this.q('.xd-px-ping-v').textContent = d ? d : '—';
			this.q('.xd-px-ping-v').className = 'xd-px-ping-v' + (d ? ' xd-' + x.delayClass(d) : '');
		}
		this.q('.xd-refresh').hidden = !(p.node && p.api);

		if (p.running && p.api) {
			const modes = { rule: T('по правилам', 'by rules'), global: T('весь трафик', 'all traffic'), direct: T('напрямую', 'direct') };
			state.textContent = p.mode == 'direct' ? T('Режим «напрямую»: прокси не используется', 'Direct mode: proxy not used') : T('Трафик идёт через прокси, ', 'Traffic goes through the proxy, ') + (modes[p.mode] || p.mode || '');
			state.className = 'xd-px-state ' + (p.mode == 'direct' ? 'xd-warn' : 'xd-ok');
		}
		else if (p.running) {
			state.textContent = T('mihomo запущен, API не отвечает', 'mihomo runs, API does not answer');
			state.className = 'xd-px-state xd-warn';
		}
		else {
			state.textContent = p.enabled ? T('Nikki включён, но не запущен', 'Nikki is enabled but not running') : T('Nikki выключен', 'Nikki is off');
			state.className = 'xd-px-state xd-muted';
		}

		const pings = this.state.pings;
		if (d != null) {
			pings.push(d || 0);
			if (pings.length > 30)
				pings.shift();
		}

		const line = card.querySelector('.xd-spark polyline');
		if (pings.length > 1) {
			const max = Math.max(60, ...pings) * 1.2;
			line.setAttribute('points', pings.map((v, i) => (i / (pings.length - 1) * 120).toFixed(1) + ',' + (34 - v / max * 30).toFixed(1)).join(' '));
		}
		line.setAttribute('class', p.running ? '' : 'off');
	}
});
