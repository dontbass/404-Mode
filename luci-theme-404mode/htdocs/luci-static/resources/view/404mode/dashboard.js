'use strict';
'require view';
'require rpc';
'require uci';
'require poll';
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
const callModemInfo = rpc.declare({ object: 'qmodem', method: 'info', params: [ 'config_section' ], expect: { '': {} } });
const callModemStats = rpc.declare({ object: 'qmodem', method: 'get_stats', params: [ 'config_section' ], expect: { '': {} } });

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
					E('a', { 'class': 'xd-seg-btn', 'data-slot': '1', 'href': L.url('admin/modem/qmodem') }, [ 'SIM 1' ]),
					E('a', { 'class': 'xd-seg-btn', 'data-slot': '2', 'href': L.url('admin/modem/qmodem') }, [ 'SIM 2' ])
				]),
				E('span', { 'class': 'xd-net' }, [ '—' ]),
				E('span', { 'class': 'xd-net-mode' }, [ '' ]),
				E('span', { 'class': 'xd-online' }, [ E('i', { 'class': 'xd-dot' }), E('span', { 'class': 'xd-online-text' }, [ T('Ищем модем…', 'Looking for a modem…') ]) ])
			]),
			E('div', { 'class': 'xd-modem-body' }, [
				E('div', { 'class': 'xd-modem-main' }, [
					E('div', { 'class': 'xd-op' }, [ '…' ]),
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
				E('div', {}, [ E('dt', {}, [ 'Cell ID' ]), E('dd', { 'data-f': 'cell' }, [ '—' ]) ]),
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
			E('a', { 'class': 'xd-px-node', 'href': L.url('admin/proxy') }, [
				E('span', { 'class': 'xd-px-flag' }),
				E('span', { 'class': 'xd-px-txt' }, [
					E('b', { 'class': 'xd-px-name' }, [ '—' ]),
					E('small', { 'class': 'xd-px-via' }, [ '' ])
				])
			]),
			E('div', { 'class': 'xd-px-bottom' }, [
				E('div', {}, [
					E('div', { 'class': 'xd-px-ping' }, [ E('span', { 'class': 'xd-px-ping-v' }, [ '—' ]), E('small', {}, [ ' ' + T('мс', 'ms') ]) ]),
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

		return Promise.all([
			L.resolveDefault(callModemInfo(m.id), {}),
			this.state.statsChecked ? Promise.resolve(null) : L.resolveDefault(callModemStats(m.id), null)
		]).then(([ res, stats ]) => {
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

		const slot = m.slot != null ? (+m.slot === 0 ? 1 : +m.slot) : null;
		this.root.querySelectorAll('.xd-modem [data-slot]').forEach(b => b.setAttribute('aria-current', slot == +b.getAttribute('data-slot') ? 'true' : 'false'));

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
		f('bands', m.bands.map(b => b.band).join(' + ') || null);

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

	tickProxy() {
		return x.proxy().then(p => this.paintProxy(p));
	},

	paintProxy(p) {
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
		this.q('.xd-px-ping-v').textContent = d ? d : '—';

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
