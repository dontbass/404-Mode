'use strict';
'require view';
'require rpc';
'require uci';
'require poll';
'require ui';
'require neon-404mode as x';

/*
 * 404 Mode — the modem screen: SIM slot, IMEI and TTL, band locking,
 * a scan of the cells around, USSD and the latest SMS.
 *
 * Data and actions go through QModem (ubus qmodem): info, get_lockband /
 * set_lockband, get_neighborcell, get_imei / set_imei, get_sms /
 * delete_sms, send_at (USSD, PIN state, SIM slot on Quectel), do_reboot.
 * TTL is an nftables file the 404mode rpcd plugin writes (ttl / ttl_set).
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const Q = (method, params) => rpc.declare({ object: 'qmodem', method: method, params: [ 'config_section' ].concat(params || []), expect: { '': {} } });

const callInfo = Q('info');
const callLock = Q('get_lockband');
const callSetLock = Q('set_lockband', [ 'params' ]);
const callNeigh = Q('get_neighborcell');
const callImei = Q('get_imei');
const callSetImei = Q('set_imei', [ 'imei' ]);
const callSms = Q('get_sms');
const callDelSms = Q('delete_sms', [ 'index' ]);
const callAt = Q('send_at', [ 'params' ]);
const callAtCfg = Q('get_at_cfg');
const callReboot = Q('do_reboot', [ 'params' ]);
const callRebootCaps = Q('get_reboot_caps');
const callSimCaps = Q('get_sim_switch_capabilities');
const callSetSim = Q('set_sim_slot', [ 'slot' ]);
const callTtl = rpc.declare({ object: '404mode', method: 'ttl', expect: { '': {} } });
const callSetTtl = rpc.declare({ object: '404mode', method: 'ttl_set', params: [ 'out', 'in', 'dev' ], expect: { '': {} } });
const callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });

const T = (ru, en) => x.t(ru, en);
const wait = ms => new Promise(r => window.setTimeout(r, ms));
const later = (p, ms) => Promise.all([ p, wait(ms) ]).then(r => r[0]);

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
	nr = nr || n > 100000;
	const hit = (nr ? NR_BANDS : LTE_BANDS).find(b => n >= b[1] && n <= b[2]);
	return hit ? (nr ? 'n' : 'B') + hit[0] : null;
}

/* MHz people know the bands by */
const FREQ = { 1: '2100', 3: '1800', 5: '850', 7: '2600', 8: '900', 20: '800', 28: '700', 32: '1500', 38: '2600', 40: '2300', 41: '2500', 42: '3500', 43: '3700', 77: '3700', 78: '3500', 79: '4700' };

const CLASSES = [
	[ 'LTE', '4G LTE', 'B' ],
	[ 'NR_NSA', T('5G NSA, вместе с LTE', '5G NSA, with LTE'), 'n' ],
	[ 'NR', T('5G SA, отдельная сеть', '5G SA, standalone'), 'n' ],
	[ 'UMTS', '3G UMTS', 'B' ]
];

const ICON = {
	sim: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="9" y="11" width="6" height="7" rx="1"/><path d="M12 11v7M9 14.5h6"/>',
	radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
	send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
	tower: '<path d="M12 10v11M8 21h8M9 21l3-11 3 11"/><circle cx="12" cy="8" r="1.6"/><path d="M8.5 4.5a5 5 0 0 0 0 7M15.5 4.5a5 5 0 0 1 0 7"/>'
};

/* ---------- small parsers ---------- */

function infoMap(list) {
	const m = {};
	(Array.isArray(list) ? list : []).forEach(e => {
		if (!e || e.value == null || e.value === '' || e.value === '-')
			return;
		const k = e.key + (e.extra_info ? '@' + e.extra_info : '');
		if (!(k in m)) m[k] = String(e.value).trim();
		if (!(e.key in m)) m[e.key] = String(e.value).trim();
	});
	return m;
}

function luhn(s) {
	let sum = 0;
	for (let i = 0; i < s.length; i++) {
		let d = +s[s.length - 1 - i];
		if (i % 2) { d *= 2; if (d > 9) d -= 9; }
		sum += d;
	}
	return sum % 10 == 0;
}

function ucs2(hex) {
	let out = '';
	for (let i = 0; i + 3 < hex.length; i += 4)
		out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
	return out;
}

/* "+CUSD: 0,"Баланс…",15" → { text, more } */
function parseCusd(res) {
	const m = /\+CUSD:\s*(\d)(?:,\s*"([\s\S]*?)"\s*(?:,\s*(\d+))?)?/.exec(res || '');
	if (!m)
		return null;
	let text = m[2] || '';
	const dcs = +m[3];
	if ((dcs == 72 || dcs == 17 || /^(?:[0-9A-F]{4})+$/i.test(text)) && text.length >= 4 && /^[0-9A-F]+$/i.test(text))
		text = ucs2(text);
	return { status: +m[1], text: text.trim(), more: m[1] == '1' };
}

function cmeText(res) {
	const m = /\+CM[ES] ERROR:\s*(\d+|[^\r\n]+)/.exec(res || '');
	if (!m)
		return null;
	const map = {
		'3': T('Модем не разрешил эту операцию.', 'The modem refused the operation.'),
		'4': T('Модем не поддерживает USSD в этом режиме.', 'The modem does not support USSD in this mode.'),
		'10': T('SIM-карта не вставлена.', 'No SIM card.'),
		'30': T('Нет сети для USSD: модем держит только передачу данных по LTE, без голосовой связи. Оператор отвечает на USSD через 2G/3G или VoLTE.', 'No network for USSD: the modem is on LTE data only, without voice. Operators answer USSD over 2G/3G or VoLTE.'),
		'100': T('Оператор не ответил на запрос.', 'The operator did not answer.')
	};
	return map[m[1]] || T('Модем ответил ошибкой ', 'The modem answered with error ') + m[1] + '.';
}

function signalClass(rsrp) {
	if (rsrp == null || isNaN(rsrp)) return 'none';
	return rsrp >= -90 ? 'ok' : (rsrp >= -105 ? 'warn' : 'bad');
}

function when(ts) {
	const d = new Date(ts * 1000);
	if (isNaN(d))
		return '';
	const now = new Date();
	const time = d.toLocaleTimeString(x.RU ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
	if (d.toDateString() == now.toDateString())
		return T('сегодня, ', 'today, ') + time;
	const y = new Date(now); y.setDate(now.getDate() - 1);
	if (d.toDateString() == y.toDateString())
		return T('вчера, ', 'yesterday, ') + time;
	return d.toLocaleDateString(x.RU ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }) + ', ' + time;
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

return view.extend({
	load() {
		x.css();

		return Promise.all([
			L.resolveDefault(uci.load('qmodem'), null),
			L.resolveDefault(uci.load('network'), null)
		]).then(() => {
			const modems = [];
			uci.sections('qmodem', 'modem-device', s => {
				if (s.enabled !== '0')
					modems.push({ id: s['.name'], name: s.name || s['.name'] });
			});
			return modems;
		});
	},

	render(modems) {
		this.modems = modems || [];
		this.m = this.modems[0] || null;
		this.st = { info: {}, lock: null, sel: {}, sms: [], sim: { caps: null, pin: null, lock: null } };

		const root = E('div', { 'class': 'xd xm' }, [
			E('div', { 'class': 'xm-head' }, [
				E('div', {}, [
					E('h2', { 'name': 'content' }, [ T('Модем', 'Modem') ]),
					E('div', { 'class': 'xm-sub' }, [ this.m ? this.m.name : '' ])
				]),
				E('div', { 'class': 'xm-facts' }),
				this.modems.length > 1 ? E('div', { 'class': 'xd-seg', 'role': 'group' }, this.modems.map((m, i) =>
					E('button', { 'type': 'button', 'class': 'xd-seg-btn', 'aria-pressed': i ? 'false' : 'true', 'click': ev => this.pickModem(i, ev.currentTarget) }, [ m.name ]))) : ''
			]),
			this.m ? E('div', { 'class': 'xd-grid xm-grid' }, [
				this.renderSim(),
				this.renderBands(),
				this.renderUssd(),
				this.renderScan()
			]) : E('div', { 'class': 'xd-card xm-empty' }, [
				E('h3', {}, [ T('Модем не найден', 'No modem found') ]),
				E('p', { 'class': 'xd-muted' }, [ T('QModem не видит включённых модемов. Добавьте модем в настройках QModem.', 'QModem lists no enabled modem. Add one in the QModem settings.') ]),
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/modem/qmodem/settings') }, [ T('Настройки QModem', 'QModem settings') ])
			])
		]);

		this.root = root;

		if (this.m) {
			window.setTimeout(() => this.boot(), 0);
			poll.add(L.bind(this.tickInfo, this), 8);
		}

		return root;
	},

	q(sel) { return this.root.querySelector(sel); },

	pickModem(i, btn) {
		this.m = this.modems[i];
		btn.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
		this.q('.xm-sub').textContent = this.m.name;
		this.st.sim = { caps: null, pin: null, lock: null };
		this.st.port = null;
		this.boot();
	},

	boot() {
		const id = this.m.id;
		return Promise.all([
			this.tickInfo(),
			L.resolveDefault(callAtCfg(id), {}).then(r => {
				const cfg = r.at_cfg || {};
				this.st.port = cfg.using_port || this.st.info.at_port || null;
				this.st.quimslot = (cfg.cmds || []).some(c => /QUIMSLOT=/.test(c.value || ''));
			}),
			L.resolveDefault(callSimCaps(id), null).then(r => { this.st.sim.caps = r && (r.supportSwitch == '1' || r.supportSwitch === true) ? r : false; }),
			L.resolveDefault(callRebootCaps(id), {}).then(r => { this.st.reboot = (r.reboot_caps || {}).soft_reboot_caps == 1; }),
			this.loadImei(),
			this.loadTtl(),
			this.loadBands(),
			this.loadSms()
		]).then(() => this.loadPin());
	},

	tickInfo() {
		if (!this.m)
			return Promise.resolve();
		return L.resolveDefault(callInfo(this.m.id), {}).then(r => {
			this.st.info = infoMap(r.modem_info);
			this.paintFacts();
			this.paintSim();
			this.paintServing();
		});
	},

	/* the serving cell in one object */
	serving() {
		const i = this.st.info;
		const nr = /SA/.test((i.network_mode || '') + ' ' + (i['Network Type'] || '')) && !/NSA/.test(i.network_mode || '');
		const rat = nr ? 'NR' : 'LTE';
		const g = k => i[k + '@' + rat] || i[k];
		const arfcn = g('EARFCN') || g('ARFCN');
		return {
			rat: rat,
			cell: g('Cell ID'),
			pci: g('Physical Cell ID'),
			arfcn: arfcn,
			band: bandOf(arfcn, nr),
			rsrp: parseFloat(g('RSRP')),
			tac: g('TAC'),
			plmn: (g('MCC') || '') + (g('MNC') || ''),
			operator: x.operator(i.ISP, (g('MCC') || '') + (g('MNC') || '')),
			online: i.connect_status == 'Yes'
		};
	},

	paintFacts() {
		const i = this.st.info, s = this.serving();
		const facts = this.q('.xm-facts');
		const fact = (label, val, cls) => val ? E('span', { 'class': 'xm-fact ' + (cls || '') }, [ E('small', {}, [ label ]), E('b', {}, [ val ]) ]) : '';

		facts.innerHTML = '';
		[
			fact(T('Сеть', 'Network'), s.operator ? s.operator + (s.band ? ' · ' + s.band : '') : null),
			fact(T('Связь', 'Link'), s.online ? T('в сети', 'online') : T('нет связи', 'offline'), s.online ? 'xm-on' : 'xm-off'),
			fact(T('Температура', 'Temperature'), i.temperature ? i.temperature.replace(/\s*°?C$/, ' °C') : null),
			fact(T('Прошивка', 'Firmware'), i.revision ? i.revision.replace(/_.*$/, '') : null)
		].forEach(el => el && facts.appendChild(el));

		if (i.manufacturer || i.name)
			this.q('.xm-sub').textContent = [ i.manufacturer, i.name ].filter(Boolean).join(' ');
	},

	/* ======================= SIM, IMEI, TTL ======================= */

	renderSim() {
		const simBtn = slot => E('button', {
			'type': 'button', 'class': 'xm-simcard', 'data-slot': slot,
			'click': ev => this.switchSim(ev.currentTarget.getAttribute('data-slot'))
		}, [
			x.icon(ICON.sim, 'xm-simchip'),
			E('span', { 'class': 'xm-sim-body' }, [
				E('span', { 'class': 'xm-sim-top' }, [ E('b', {}, [ 'SIM ' + slot ]), E('span', { 'class': 'xm-sim-badge' }) ]),
				E('span', { 'class': 'xm-sim-state' }, [ E('i', { 'class': 'xd-dot' }), E('span', {}, [ '…' ]) ]),
				E('small', { 'class': 'xm-sim-pin' }, [ '' ]),
				E('small', { 'class': 'xm-sim-id' }, [ '' ])
			])
		]);

		const imei = E('input', {
			'type': 'text', 'class': 'cbi-input-text xm-imei-in', 'inputmode': 'numeric', 'maxlength': 15, 'autocomplete': 'off', 'spellcheck': 'false',
			'aria-label': 'IMEI', 'placeholder': '15 ' + T('цифр', 'digits'),
			'input': () => this.checkImei()
		});

		const preset = (dir, v, label) => E('button', {
			'type': 'button', 'class': 'xd-seg-btn', 'data-ttl': dir, 'data-v': v, 'aria-pressed': 'false',
			'click': () => this.setTtlField(dir, v)
		}, [ label || String(v) ]);

		const ttlRow = (dir, label) => E('div', { 'class': 'xm-ttl-row' }, [
			E('span', { 'class': 'xm-ttl-l' }, [ label ]),
			E('div', { 'class': 'xd-seg xd-seg-s' }, [ preset(dir, 0, T('Выкл', 'Off')), preset(dir, 64), preset(dir, 65), preset(dir, 128) ]),
			E('input', { 'type': 'number', 'min': 1, 'max': 255, 'class': 'cbi-input-text xm-ttl-in', 'data-dir': dir, 'aria-label': label + ' TTL', 'placeholder': '—',
				'input': ev => this.setTtlField(dir, ev.currentTarget.value, true) })
		]);

		return E('section', { 'class': 'xd-card xm-sim', 'data-search': 'sim сим imei имей ttl ттл pin пин слот профиль' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ T('SIM-карты и профиль модема', 'SIM cards and modem profile') ]),
					E('div', { 'class': 'xd-muted' }, [ T('Какая SIM работает, под каким IMEI модем виден сети и какой TTL уходит оператору', 'Which SIM is in use, the IMEI the network sees and the TTL the operator gets') ])
				])
			]),
			E('div', { 'class': 'xm-sim-grid' }, [
				E('div', { 'class': 'xm-pane xm-pane-sim' }, [
					E('div', { 'class': 'xm-pane-h' }, [ T('Слот SIM', 'SIM slot') ]),
					E('div', { 'class': 'xm-sims' }, [ simBtn('1'), simBtn('2') ]),
					E('small', { 'class': 'xm-note xm-sim-note' }, [ '' ])
				]),
				E('div', { 'class': 'xm-pane xm-pane-imei' }, [
					E('div', { 'class': 'xm-pane-h' }, [ 'IMEI' ]),
					E('div', { 'class': 'xm-inline' }, [
						imei,
						E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action xm-imei-btn', 'click': ev => this.applyImei(ev.currentTarget) }, [ T('Применить', 'Apply') ])
					]),
					E('small', { 'class': 'xm-note xm-imei-note' }, [ T('15 цифр, последняя — контрольная.', '15 digits, the last one is a check digit.') ]),
					E('small', { 'class': 'xm-note xm-imei-cur' }, [ '' ])
				]),
				E('div', { 'class': 'xm-pane xm-pane-ttl' }, [
					E('div', { 'class': 'xm-pane-h' }, [ T('Фиксация TTL', 'Fixed TTL'), E('span', { 'class': 'xm-ttl-state' }) ]),
					ttlRow('out', T('Исходящий', 'Outgoing')),
					ttlRow('in', T('Входящий', 'Incoming')),
					E('div', { 'class': 'xm-inline xm-ttl-foot' }, [
						E('small', { 'class': 'xm-note xm-ttl-dev' }, [ '' ]),
						E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action xm-ttl-btn', 'click': ev => this.applyTtl(ev.currentTarget) }, [ T('Применить TTL', 'Apply TTL') ])
					])
				])
			])
		]);
	},

	loadPin() {
		const port = this.st.port;
		if (!port)
			return Promise.resolve();
		const at = cmd => L.resolveDefault(callAt(this.m.id, { port: port, at: cmd }), {}).then(r => (r.at_cfg || {}).res || '');
		return at('AT+CPIN?').then(res => {
			const m = /\+CPIN:\s*([^\r\n]+)/.exec(res);
			this.st.sim.pin = m ? m[1].trim() : null;
			return at('AT+CLCK="SC",2');
		}).then(res => {
			const m = /\+CLCK:\s*(\d)/.exec(res);
			this.st.sim.lock = m ? m[1] == '1' : null;
			this.paintSim();
		});
	},

	simCanSwitch() {
		if (this.st.sim.caps)
			return 'qmodem';
		if (this.st.port && (this.st.quimslot || /quectel/i.test(this.st.info.manufacturer || '')))
			return 'at';
		return null;
	},

	paintSim() {
		const i = this.st.info, sim = this.st.sim;
		const cur = sim.switching || sim.cur || i['SIM Slot'] || '1';
		const how = this.simCanSwitch();
		const s = this.serving();
		const ready = /ready/i.test(i['SIM Status'] || '') || /READY/.test(sim.pin || '');

		this.root.querySelectorAll('.xm-simcard').forEach(b => {
			const slot = b.getAttribute('data-slot');
			const on = slot == cur;
			const state = b.querySelector('.xm-sim-state span');
			const dot = b.querySelector('.xm-sim-state .xd-dot');
			const pin = b.querySelector('.xm-sim-pin');

			b.setAttribute('aria-pressed', on ? 'true' : 'false');
			b.disabled = !!sim.switching || (!on && !how);
			b.title = on ? T('Эта SIM сейчас работает', 'This SIM is in use') : (how ? T('Переключиться на SIM ', 'Switch to SIM ') + slot : T('Модем не переключает слоты', 'This modem cannot switch slots'));
			b.querySelector('.xm-sim-badge').textContent = on ? T('Активна', 'Active') : '';

			if (on && sim.switching) {
				state.textContent = T('Переключаем…', 'Switching…');
				dot.className = 'xd-dot xm-dot-warn';
				pin.textContent = '';
			}
			else if (on) {
				const p = sim.pin || '';
				state.textContent = ready ? T('Готова', 'Ready') : (/PIN/.test(p) ? T('Ждёт PIN-код', 'Waiting for PIN') : (/PUK/.test(p) ? T('Заблокирована', 'Blocked') : (i['SIM Status'] || T('Нет данных', 'No data'))));
				dot.className = 'xd-dot ' + (ready ? 'xm-dot-ok' : 'xm-dot-bad');
				pin.textContent = /PUK/.test(p) ? T('Нужен PUK-код от оператора', 'Needs the PUK code from the operator')
					: /SIM PIN/.test(p) ? T('Введите PIN-код в настройках QModem', 'Enter the PIN in the QModem settings')
					: (sim.lock === true ? T('PIN-код введён, запрос включён', 'PIN entered, PIN lock on')
					: (ready ? T('PIN-код не требуется', 'No PIN code needed') : ''));
			}
			else {
				state.textContent = T('Резерв', 'Standby');
				dot.className = 'xd-dot xm-dot-idle';
				pin.textContent = how ? T('Нажмите, чтобы переключиться', 'Click to switch') : '';
			}

			b.querySelector('.xm-sim-id').textContent = on && !sim.switching
				? [ s.operator, i.ICCID ? 'ICCID ···' + i.ICCID.replace(/F+$/i, '').slice(-4) : '' ].filter(Boolean).join(' · ') : '';
		});

		this.q('.xm-sim-note').textContent = how ? '' : T('QModem не умеет переключать слоты этого модема. Карта меняется вручную.', 'QModem cannot switch slots on this modem. Swap the card by hand.');
	},

	switchSim(slot) {
		const sim = this.st.sim, i = this.st.info;
		const cur = sim.cur || i['SIM Slot'] || '1';
		const how = this.simCanSwitch();
		if (!how || slot == cur || sim.switching)
			return;

		const pane = this.q('.xm-pane-sim');
		sim.switching = slot;
		pane.classList.add('xm-busy');
		pane.setAttribute('data-busy', T('Переключаем на SIM ', 'Switching to SIM ') + slot + '…');
		this.paintSim();

		const act = how == 'qmodem'
			? L.resolveDefault(callSetSim(this.m.id, slot), null).then(r => !!(r && r.success))
			: L.resolveDefault(callAt(this.m.id, { port: this.st.port, at: 'AT+QUIMSLOT=' + slot }), {}).then(r => /OK/.test((r.at_cfg || {}).res || ''));

		later(act, 1500).then(ok => {
			if (!ok)
				return ok;
			/* the modem re-reads the card: wait until it reports the new slot */
			const until = Date.now() + 20000;
			const check = () => this.tickInfo().then(() => (this.st.info['SIM Slot'] == slot || Date.now() > until) ? ok : wait(2000).then(check));
			return check();
		}).then(ok => {
			sim.switching = null;
			if (ok) sim.cur = slot;
			pane.classList.remove('xm-busy');
			this.paintSim();
			x.toast(ok ? T('Работает SIM ' + slot + '. Модем регистрируется в сети.', 'SIM ' + slot + ' is in use. The modem is registering.')
				: T('Модем не переключил слот. Проверьте, вставлена ли SIM ' + slot + '.', 'The modem did not switch. Is SIM ' + slot + ' inserted?'), ok ? 'ok' : 'warn');
			return this.loadPin();
		});
	},

	loadImei() {
		return L.resolveDefault(callImei(this.m.id), {}).then(r => {
			this.st.imei = String(r.imei || this.st.info.IMEI || '').trim();
			const inp = this.q('.xm-imei-in');
			if (document.activeElement !== inp)
				inp.value = this.st.imei;
			this.q('.xm-imei-cur').textContent = this.st.imei ? T('Сейчас в модеме: ', 'Now in the modem: ') + this.st.imei : '';
			this.checkImei();
		});
	},

	checkImei() {
		const inp = this.q('.xm-imei-in'), note = this.q('.xm-imei-note');
		const v = inp.value.replace(/\D/g, '');
		if (v !== inp.value) inp.value = v;

		let ok = false, text = T('15 цифр, последняя — контрольная.', '15 digits, the last one is a check digit.'), cls = '';
		if (v.length && v.length < 15)
			text = T('Осталось цифр: ' + (15 - v.length), (15 - v.length) + ' more digits');
		else if (v.length == 15 && v == this.st.imei)
			text = T('Этот IMEI уже в модеме.', 'This IMEI is already set.');
		else if (v.length == 15 && !luhn(v)) {
			text = T('Контрольная цифра не сходится: сеть может не принять такой IMEI.', 'The check digit does not match: the network may reject this IMEI.');
			cls = 'xm-note-warn';
			ok = true;
		}
		else if (v.length == 15) {
			text = T('Контрольная цифра в порядке.', 'Check digit is fine.');
			cls = 'xm-note-ok';
			ok = true;
		}

		note.textContent = text;
		note.className = 'xm-note xm-imei-note ' + cls;
		this.q('.xm-imei-btn').disabled = !ok;
		return ok;
	},

	applyImei(btn) {
		const v = this.q('.xm-imei-in').value;
		if (!this.checkImei())
			return;

		/* the first click asks, the second one writes */
		if (!btn.classList.contains('xm-confirm')) {
			btn.classList.add('xm-confirm');
			btn.textContent = T('Точно сменить?', 'Change it?');
			window.clearTimeout(this.st.imeiTimer);
			this.st.imeiTimer = window.setTimeout(() => { btn.classList.remove('xm-confirm'); btn.textContent = T('Применить', 'Apply'); }, 4000);
			return;
		}

		window.clearTimeout(this.st.imeiTimer);
		btn.classList.remove('xm-confirm');
		btn.classList.add('busy');
		btn.disabled = true;
		btn.textContent = T('Записываем…', 'Writing…');

		later(L.resolveDefault(callSetImei(this.m.id, v), null), 900).then(() => this.loadImei()).then(() => {
			btn.classList.remove('busy');
			btn.textContent = T('Применить', 'Apply');
			const done = this.st.imei == v;
			if (done)
				x.toast(T('IMEI успешно изменён, требуется перезагрузка модема.', 'IMEI changed, the modem needs a restart.'), 'ok',
					this.st.reboot ? { label: T('Перезагрузить модем', 'Restart the modem'), fn: () => this.rebootModem() } : null);
			else
				x.toast(T('Модем не записал IMEI. Не все прошивки разрешают его менять.', 'The modem did not take the IMEI. Not every firmware allows it.'), 'bad');
			this.checkImei();
		});
	},

	rebootModem() {
		L.resolveDefault(callReboot(this.m.id, { method: 'soft' }), null).then(() =>
			x.toast(T('Модем перезагружается, связь вернётся примерно через минуту.', 'The modem is restarting, the link is back in about a minute.'), 'info'));
	},

	/* the device the modem link runs on, for the TTL rule */
	ttlDevices() {
		const names = [];
		uci.sections('network', 'interface', s => {
			if (s.modem_config == this.m.id) names.push(s['.name']);
		});
		return L.resolveDefault(callIfaces(), []).then(list => {
			const dev = [];
			list.forEach(i => {
				if (names.indexOf(i.interface) < 0) return;
				const d = i.l3_device || i.device;
				if (d && d[0] != '@' && dev.indexOf(d) < 0) dev.push(d);
			});
			if (!dev.length)
				names.forEach(n => { const d = uci.get('network', n, 'device'); if (d && d[0] != '@' && dev.indexOf(d) < 0) dev.push(d); });
			return dev;
		});
	},

	loadTtl() {
		return Promise.all([ L.resolveDefault(callTtl(), null), this.ttlDevices() ]).then(([ t, dev ]) => {
			this.st.ttl = t;
			this.st.ttlDev = dev;
			this.setTtlField('out', t ? t.out : 0);
			this.setTtlField('in', t ? t.in : 0);
			this.paintTtl();
		});
	},

	setTtlField(dir, v, typed) {
		v = parseInt(v, 10);
		v = isNaN(v) || v < 0 ? 0 : Math.min(v, 255);
		this.root.querySelectorAll('[data-ttl="' + dir + '"]').forEach(b => b.setAttribute('aria-pressed', +b.getAttribute('data-v') == v ? 'true' : 'false'));
		const inp = this.q('.xm-ttl-in[data-dir="' + dir + '"]');
		if (!typed) inp.value = v ? v : '';
		(this.st.ttlSel = this.st.ttlSel || {})[dir] = v;
	},

	paintTtl() {
		const t = this.st.ttl, dev = this.st.ttlDev || [];
		const state = this.q('.xm-ttl-state');
		const on = t && t.active && (t.out || t.in);
		state.className = 'xm-ttl-state ' + (on ? 'xm-on' : '');
		state.textContent = !t ? T('нет доступа', 'no access') : on
			? [ t.out ? T('исх. ', 'out ') + t.out : '', t.in ? T('вх. ', 'in ') + t.in : '' ].filter(Boolean).join(' · ')
			: T('не задан', 'not set');
		this.q('.xm-ttl-dev').textContent = dev.length ? T('Интерфейс ', 'Interface ') + dev.join(', ') + T('. Правило nftables остаётся после перезагрузки.', '. The nftables rule survives a reboot.')
			: T('Не нашёл интерфейс модема в сети.', 'No network interface for the modem.');
		this.q('.xm-ttl-btn').disabled = !t || !dev.length;
	},

	applyTtl(btn) {
		const sel = this.st.ttlSel || {}, dev = this.st.ttlDev || [];
		btn.disabled = true;
		btn.classList.add('busy');
		later(L.resolveDefault(callSetTtl(sel.out || 0, sel.in || 0, dev.join(' ')), { error: 'rpc' }), 700).then(r => {
			btn.classList.remove('busy');
			btn.disabled = false;
			if (r.error) {
				x.toast(r.error == 'nft' ? T('Межсетевой экран не принял правило, оставил всё как было.', 'The firewall rejected the rule, nothing changed.')
					: T('Не получилось записать TTL: ', 'Could not set the TTL: ') + r.error, 'bad');
				return;
			}
			this.st.ttl = r;
			this.paintTtl();
			x.toast(r.out || r.in ? T('TTL зафиксирован: ', 'TTL fixed: ') + [ r.out ? T('исходящий ', 'outgoing ') + r.out : '', r.in ? T('входящий ', 'incoming ') + r.in : '' ].filter(Boolean).join(', ') + '.'
				: T('Фиксация TTL снята.', 'TTL is no longer fixed.'), 'ok');
		});
	},

	/* ======================= bands ======================= */

	renderBands() {
		return E('section', { 'class': 'xd-card xm-bands', 'data-search': 'бэнд band частоты диапазон lte 5g nr блокировка lock' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ T('Частоты и бэнды', 'Bands') ]),
					E('div', { 'class': 'xd-muted' }, [ T('Отметьте диапазоны, на которых модему разрешено работать', 'Tick the bands the modem may use') ])
				]),
				E('span', { 'class': 'xm-pill xm-now-band', 'hidden': '' })
			]),
			E('div', { 'class': 'xm-bgroups' }, [ E('div', { 'class': 'xm-skel' }) ]),
			E('div', { 'class': 'xm-banner', 'hidden': '' }, [
				E('div', { 'class': 'xm-banner-wave', 'aria-hidden': 'true' }, [ E('i'), E('i'), E('i'), E('i'), E('i') ]),
				E('span', { 'class': 'xm-banner-t' }, [ '' ]),
				E('i', { 'class': 'xm-banner-bar' })
			]),
			E('div', { 'class': 'xm-actions' }, [
				E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': () => this.bandsInvert() }, [ T('Инвертировать выбор', 'Invert selection') ]),
				E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': () => this.bandsAll() }, [ T('Все диапазоны', 'All bands') ]),
				E('span', { 'class': 'xm-dirty' }, [ '' ]),
				E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action x-btn-primary xm-lock-btn', 'disabled': '', 'click': ev => this.applyBands(ev.currentTarget) }, [ T('Зафиксировать бэнды', 'Lock bands') ])
			])
		]);
	},

	loadBands() {
		return L.resolveDefault(callLock(this.m.id), {}).then(r => {
			const lb = r.lockband || r;
			const lock = {};
			CLASSES.forEach(([ cls ]) => {
				const c = lb && lb[cls];
				if (!c || !Array.isArray(c.available_band) || !c.available_band.length)
					return;
				const ids = c.available_band.map(b => String(b.band_id));
				const locked = (c.lock_band || []).map(String).filter(b => ids.indexOf(b) > -1);
				lock[cls] = { bands: c.available_band, locked: locked.length ? locked : ids.slice(), free: !locked.length };
			});
			this.st.lock = lock;
			this.st.sel = {};
			for (const k in lock) this.st.sel[k] = lock[k].locked.slice();
			this.paintBands();
		});
	},

	paintBands() {
		const box = this.q('.xm-bgroups');
		const lock = this.st.lock || {};
		const s = this.serving();
		box.innerHTML = '';

		if (!Object.keys(lock).length) {
			box.appendChild(E('p', { 'class': 'xd-muted' }, [ T('QModem не отдал список диапазонов для этого модема.', 'QModem returned no band list for this modem.') ]));
			this.q('.xm-actions').hidden = true;
			return;
		}

		CLASSES.forEach(([ cls, title, prefix ]) => {
			const g = lock[cls];
			if (!g) return;
			const sel = this.st.sel[cls];
			const chips = g.bands.map(b => {
				const id = String(b.band_id);
				const label = prefix + id;
				const live = s.band && s.band.toLowerCase() == label.toLowerCase() && (cls == 'LTE' ? s.rat == 'LTE' : cls != 'UMTS');
				const cb = E('input', { 'type': 'checkbox', 'class': 'xm-sr', 'checked': sel.indexOf(id) > -1 ? '' : null,
					'change': ev => this.toggleBand(cls, id, ev.currentTarget.checked) });
				return E('label', { 'class': 'xm-bchip' + (live ? ' xm-live' : ''), 'title': b.band_name + (live ? ' · ' + T('модем сейчас здесь', 'the modem is here now') : '') }, [
					cb,
					E('span', { 'class': 'xm-bchip-n' }, [ label ]),
					E('span', { 'class': 'xm-bchip-f' }, [ FREQ[id] ? FREQ[id] + ' ' + T('МГц', 'MHz') : '' ]),
					live ? E('i', { 'class': 'xm-bchip-live', 'aria-hidden': 'true' }) : ''
				]);
			});
			box.appendChild(E('div', { 'class': 'xm-bgroup', 'data-cls': cls }, [
				E('div', { 'class': 'xm-bgroup-h' }, [
					E('b', {}, [ title ]),
					E('small', { 'class': 'xm-bcount' }, [ this.countText(cls) ])
				]),
				E('div', { 'class': 'xm-bchips' }, chips)
			]));
		});

		this.paintDirty();
	},

	countText(cls) {
		const g = this.st.lock[cls], sel = this.st.sel[cls];
		if (sel.length == g.bands.length)
			return T('все ' + sel.length + ', без ограничений', 'all ' + sel.length + ', no lock');
		return T(sel.length + ' из ' + g.bands.length, sel.length + ' of ' + g.bands.length);
	},

	toggleBand(cls, id, on) {
		const sel = this.st.sel[cls];
		const i = sel.indexOf(id);
		if (on && i < 0) sel.push(id);
		if (!on && i > -1) sel.splice(i, 1);
		this.paintDirty();
	},

	changed() {
		const out = [];
		for (const cls in this.st.lock) {
			const a = this.st.lock[cls].locked.slice().sort().join(), b = this.st.sel[cls].slice().sort().join();
			if (a != b) out.push(cls);
		}
		return out;
	},

	paintDirty() {
		const ch = this.changed();
		this.root.querySelectorAll('.xm-bgroup').forEach(g => {
			const cls = g.getAttribute('data-cls');
			g.querySelector('.xm-bcount').textContent = this.countText(cls);
			g.classList.toggle('xm-empty-g', !this.st.sel[cls].length);
			g.querySelectorAll('input').forEach((cb, i) => { cb.checked = this.st.sel[cls].indexOf(String(this.st.lock[cls].bands[i].band_id)) > -1; });
		});
		this.q('.xm-dirty').textContent = ch.length && !this.st.locking ? T('Не применено', 'Not applied') : '';
		this.q('.xm-lock-btn').disabled = !ch.length || !!this.st.locking;
	},

	bandsInvert() {
		for (const cls in this.st.lock)
			this.st.sel[cls] = this.st.lock[cls].bands.map(b => String(b.band_id)).filter(id => this.st.sel[cls].indexOf(id) < 0);
		this.paintDirty();
	},

	bandsAll() {
		for (const cls in this.st.lock)
			this.st.sel[cls] = this.st.lock[cls].bands.map(b => String(b.band_id));
		this.paintDirty();
	},

	banner(text, kind) {
		const b = this.q('.xm-banner');
		if (!text) {
			b.classList.add('xm-banner-out');
			window.setTimeout(() => { b.hidden = true; b.classList.remove('xm-banner-out'); }, 300);
			return;
		}
		b.hidden = false;
		b.className = 'xm-banner xm-banner-' + (kind || 'busy');
		this.q('.xm-banner-t').textContent = text;
	},

	applyBands(btn) {
		const ch = this.changed();
		const empty = ch.filter(cls => !this.st.sel[cls].length);
		if (empty.length) {
			const names = empty.map(cls => (CLASSES.find(c => c[0] == cls) || [])[1]).join(', ');
			x.toast(T('Отметьте хотя бы один диапазон: ', 'Tick at least one band: ') + names + '.', 'warn');
			return;
		}

		this.st.locking = true;
		this.q('.xm-dirty').textContent = '';
		btn.disabled = true;
		btn.classList.add('busy');
		this.root.querySelector('.xm-bgroups').classList.add('xm-locked');
		this.banner(T('Модем переподключается к выбранным диапазонам…', 'The modem is reconnecting to the chosen bands…'));

		const send = ch.reduce((p, cls) => p.then(acc => {
			const ids = this.st.sel[cls].slice().sort((a, b) => a - b).join(',');
			return L.resolveDefault(callSetLock(this.m.id, { band_class: cls, lock_band: ids }), null).then(r => { acc[cls] = r; return acc; });
		}), Promise.resolve({}));

		later(send, 1200).then(() => {
			/* give the modem time to drop and find the network again */
			const until = Date.now() + 45000;
			let seen = false;
			const check = () => wait(3000).then(() => this.tickInfo()).then(() => {
				const s = this.serving();
				if (!s.online || !s.band) seen = true;
				if ((s.online && s.band && (seen || Date.now() > until - 39000)) || Date.now() > until)
					return s;
				return check();
			});
			return check();
		}).then(s => this.loadBands().then(() => s)).then(s => {
			this.st.locking = false;
			btn.classList.remove('busy');
			this.root.querySelector('.xm-bgroups').classList.remove('xm-locked');
			const ok = s.online && s.band;
			this.banner(ok ? T('В сети: ', 'Online: ') + s.band + (isNaN(s.rsrp) ? '' : ', RSRP ' + x.minus(s.rsrp) + ' ' + T('дБм', 'dBm'))
				: T('Модем ещё ищет сеть на этих диапазонах', 'The modem is still looking for a network on these bands'), ok ? 'ok' : 'warn');
			window.setTimeout(() => this.banner(null), ok ? 4000 : 7000);
			x.toast(ok ? T('Бэнды зафиксированы. Модем работает на ', 'Bands locked. The modem is on ') + s.band + '.'
				: T('Бэнды записаны, но сети на них пока нет. Если связь не вернётся, нажмите «Все диапазоны» и зафиксируйте снова.', 'Bands are saved but there is no network on them yet. If it does not come back, pick All bands and lock again.'), ok ? 'ok' : 'warn');
			this.paintDirty();
		});
	},

	paintServing() {
		const s = this.serving();
		const pill = this.q('.xm-now-band');
		if (pill) {
			pill.hidden = !s.band;
			pill.textContent = T('Сейчас ', 'Now ') + (s.band || '');
		}
		if (this.st.lock && !this.st.locking) {
			const live = this.root.querySelector('.xm-bchip.xm-live .xm-bchip-n');
			if ((live ? live.textContent : null) != s.band)
				this.paintBands();
		}
	},

	/* ======================= cell scanner ======================= */

	renderScan() {
		return E('section', { 'class': 'xd-card xm-scan', 'data-search': 'сканер вышки соты cell scanner pci соседние neighbour' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ T('Сканер сети и вышек', 'Cell scanner') ]),
					E('div', { 'class': 'xd-muted xm-scan-sub' }, [ T('Соседние соты, которые модем слышит со своего места', 'Cells the modem hears from where it stands') ])
				]),
				E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action xm-scan-btn', 'click': ev => this.scan(ev.currentTarget) }, [
					x.icon(ICON.radar), T('Начать сканирование эфира', 'Scan the air')
				])
			]),
			E('div', { 'class': 'xm-scan-body' }, [
				E('div', { 'class': 'xm-radar', 'hidden': '', 'aria-hidden': 'true' }, [
					E('div', { 'class': 'xm-radar-dish' }, [ E('i', { 'class': 'xm-radar-sweep' }), E('b'), E('b'), E('b'), E('b') ]),
					E('span', { 'class': 'xm-radar-t' }, [ T('Слушаем эфир…', 'Listening…') ])
				]),
				E('div', { 'class': 'xm-scan-empty' }, [
					x.icon(ICON.tower, 'xm-scan-ico'),
					E('p', {}, [ T('Нажмите «Начать сканирование эфира», чтобы увидеть вышки вокруг и их сигнал.', 'Press Scan the air to see the towers around and their signal.') ])
				]),
				E('div', { 'class': 'xm-table-wrap', 'hidden': '' }, [
					E('table', { 'class': 'xm-table' }, [
						E('thead', {}, [ E('tr', {}, [
							E('th', {}, [ T('Оператор', 'Operator') ]),
							E('th', {}, [ T('Сигнал, дБм', 'Signal, dBm') ]),
							E('th', {}, [ 'Band' ]),
							E('th', {}, [ 'PCI' ]),
							E('th', {}, [ 'Cell ID' ])
						]) ]),
						E('tbody')
					])
				])
			])
		]);
	},

	scan(btn) {
		const radar = this.q('.xm-radar');
		btn.disabled = true;
		btn.classList.add('busy');
		radar.hidden = false;
		this.q('.xm-scan-empty').hidden = true;
		this.q('.xm-table-wrap').classList.add('xm-dim');

		later(Promise.all([ L.resolveDefault(callNeigh(this.m.id), {}), this.tickInfo() ]), 2800).then(([ r ]) => {
			const n = r.neighborcell || r || {};
			const s = this.serving();
			const rows = [];

			if (s.pci)
				rows.push({ serving: true, op: s.operator, rsrp: s.rsrp, band: s.band, pci: s.pci, cell: s.cell, arfcn: s.arfcn });

			[ [ 'LTE', false ], [ 'NR', true ] ].forEach(([ k, nr ]) => (Array.isArray(n[k]) ? n[k] : []).forEach(c => {
				let rsrp = parseFloat(c.rsrp), rsrq = parseFloat(c.rsrq);
				/* some firmwares swap the two columns */
				if (rsrp > -30 && rsrq < -30) [ rsrp, rsrq ] = [ rsrq, rsrp ];
				const band = bandOf(c.arfcn, nr) || (c.band ? (nr ? 'n' : 'B') + c.band : '');
				if (s.pci && String(c.pci) == String(s.pci) && String(c.arfcn) == String(s.arfcn))
					return;
				rows.push({ op: s.operator, rsrp: rsrp, band: band, pci: c.pci, cell: c.cell_id || c.cellid || null, arfcn: c.arfcn, inter: /inter/i.test(c.neighbourcell || '') });
			}));

			rows.sort((a, b) => (!!b.serving - !!a.serving) || ((isNaN(b.rsrp) ? -999 : b.rsrp) - (isNaN(a.rsrp) ? -999 : a.rsrp)));
			this.paintScan(rows);
		}).then(() => {
			radar.hidden = true;
			btn.disabled = false;
			btn.classList.remove('busy');
			this.q('.xm-table-wrap').classList.remove('xm-dim');
		});
	},

	paintScan(rows) {
		const body = this.q('.xm-table tbody');
		const wrap = this.q('.xm-table-wrap');
		body.innerHTML = '';

		if (!rows.length) {
			this.q('.xm-scan-empty').hidden = false;
			this.q('.xm-scan-empty p').textContent = T('Модем не услышал ни одной соты. Попробуйте ещё раз через минуту.', 'The modem heard no cells. Try again in a minute.');
			wrap.hidden = true;
			return;
		}

		wrap.hidden = false;
		rows.forEach((r, i) => {
			const q = signalClass(r.rsrp);
			const w = isNaN(r.rsrp) ? 0 : Math.max(4, Math.min(100, (r.rsrp + 130) / 60 * 100));
			const td = (label, kids, cls) => E('td', { 'data-label': label, 'class': cls || null }, [ E('span', { 'class': 'xm-td' }, kids) ]);
			body.appendChild(E('tr', { 'class': 'xm-row' + (r.serving ? ' xm-row-serving' : ''), 'style': 'animation-delay:' + (i * 45) + 'ms' }, [
				td(T('Оператор', 'Operator'), [
					E('span', { 'class': 'xm-op' }, [ r.op || '—' ]),
					r.serving ? E('small', { 'class': 'xm-tag' }, [ T('обслуживает', 'serving') ]) : (r.inter ? E('small', { 'class': 'xm-tag xm-tag-dim' }, [ T('другая частота', 'other channel') ]) : '')
				]),
				td(T('Сигнал, дБм', 'Signal, dBm'), [
					E('b', { 'class': 'xm-sig-v xd-' + q }, [ isNaN(r.rsrp) ? '—' : x.minus(Math.round(r.rsrp)) ]),
					E('span', { 'class': 'xm-sig-bar' }, [ E('i', { 'class': 'xd-bg-' + q, 'style': 'width:' + w + '%' }) ])
				], 'xm-sig'),
				td('Band', [ E('span', { 'class': 'xm-band' }, [ r.band || '—' ]), r.arfcn ? E('small', { 'class': 'xm-arfcn' }, [ r.arfcn ]) : '' ]),
				td('PCI', [ r.pci != null ? String(r.pci) : '—' ], 'xm-mono'),
				td('Cell ID', [ r.cell || '—' ], 'xm-mono' + (r.cell ? '' : ' xm-na'))
			]));
		});

		const cnt = rows.length - (rows[0] && rows[0].serving ? 1 : 0);
		this.q('.xm-scan-sub').textContent = T('Найдено соседних сот: ' + cnt + ' · ', 'Neighbour cells: ' + cnt + ' · ') + new Date().toLocaleTimeString(x.RU ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	},

	/* ======================= USSD and SMS ======================= */

	renderUssd() {
		const recent = store('404mode.ussd') || [ '*100#' ];
		const input = E('input', { 'type': 'text', 'class': 'cbi-input-text xm-ussd-in', 'value': recent[0] || '*100#', 'aria-label': T('USSD-запрос', 'USSD code'),
			'inputmode': 'tel', 'autocomplete': 'off', 'keydown': ev => { if (ev.key == 'Enter') this.sendUssd(); } });

		return E('section', { 'class': 'xd-card xm-msg', 'data-search': 'sms смс ussd усд баланс сообщения *100#' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ T('SMS и USSD', 'SMS and USSD') ]),
					E('div', { 'class': 'xd-muted' }, [ T('Запрос оператору и последние сообщения', 'Ask the operator, read the latest messages') ])
				])
			]),
			E('div', { 'class': 'xm-inline xm-ussd' }, [
				input,
				E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action xm-ussd-btn', 'click': () => this.sendUssd() }, [ x.icon(ICON.send), T('Отправить', 'Send') ])
			]),
			E('div', { 'class': 'xm-codes' }, this.codeChips(recent)),
			E('div', { 'class': 'xm-ussd-out', 'hidden': '' }),
			E('div', { 'class': 'xm-sms-h' }, [
				E('b', {}, [ T('Последние SMS', 'Latest SMS') ]),
				E('a', { 'class': 'xd-muted', 'href': L.url('admin/modem/qmodem/sms') }, [ T('Все сообщения', 'All messages') ])
			]),
			E('div', { 'class': 'xm-sms-list' }, [ E('div', { 'class': 'xm-skel' }) ])
		]);
	},

	codeChips(list) {
		const base = [ '*100#', '*102#', '*105#' ];
		const all = list.concat(base.filter(c => list.indexOf(c) < 0)).slice(0, 5);
		return all.map(c => E('button', { 'type': 'button', 'class': 'xm-code', 'click': () => { this.q('.xm-ussd-in').value = c; this.sendUssd(); } }, [ c ]));
	},

	sendUssd() {
		const inp = this.q('.xm-ussd-in'), btn = this.q('.xm-ussd-btn'), out = this.q('.xm-ussd-out');
		const code = inp.value.trim();
		if (!/^[0-9*#+]{1,32}$/.test(code)) {
			x.toast(T('USSD состоит из цифр, * и #, например *100#.', 'A USSD code is digits, * and #, like *100#.'), 'warn');
			return;
		}
		if (!this.st.port) {
			x.toast(T('Не знаю AT-порт модема: проверьте настройки QModem.', 'The modem AT port is unknown: check the QModem settings.'), 'bad');
			return;
		}

		const recent = [ code ].concat((store('404mode.ussd') || []).filter(c => c != code)).slice(0, 3);
		store('404mode.ussd', recent);

		btn.disabled = true;
		btn.classList.add('busy');
		out.hidden = false;
		out.className = 'xm-ussd-out xm-wait';
		out.innerHTML = '';
		out.appendChild(E('div', { 'class': 'xm-ussd-q' }, [ code ]));
		out.appendChild(E('div', { 'class': 'xm-ussd-a' }, [ E('span', { 'class': 'xm-typing' }, [ E('i'), E('i'), E('i') ]) ]));

		later(L.resolveDefault(callAt(this.m.id, { port: this.st.port, at: 'AT+CUSD=1,"' + code + '",15' }), {}), 900).then(r => {
			const res = (r.at_cfg || {}).res || '';
			const ans = parseCusd(res);
			const err = cmeText(res);
			const a = out.querySelector('.xm-ussd-a');
			out.classList.remove('xm-wait');
			a.innerHTML = '';

			if (ans && ans.text) {
				a.textContent = ans.text;
				out.classList.add('xm-ok');
				if (ans.more)
					a.appendChild(E('small', {}, [ T('Оператор ждёт ответа: введите цифру и нажмите «Отправить».', 'The operator waits for a reply: type a digit and press Send.') ]));
				inp.value = ans.more ? '' : code;
				if (ans.more) inp.focus();
			}
			else if (err) {
				a.textContent = err;
				out.classList.add('xm-err');
			}
			else if (/OK/.test(res)) {
				a.textContent = T('Запрос ушёл оператору, но ответ не успел прийти. Иногда оператор присылает его SMS: список ниже обновится сам.', 'The request went out but the answer did not arrive in time. Operators sometimes reply by SMS: the list below refreshes itself.');
				out.classList.add('xm-err');
				window.setTimeout(() => this.loadSms(), 8000);
			}
			else {
				a.textContent = T('Модем не ответил. Проверьте, что AT-порт ', 'The modem did not answer. Check that the AT port ') + this.st.port + T(' свободен.', ' is free.');
				out.classList.add('xm-err');
			}

			btn.disabled = false;
			btn.classList.remove('busy');
			const codes = this.q('.xm-codes');
			codes.innerHTML = '';
			this.codeChips(recent).forEach(c => codes.appendChild(c));
		});
	},

	loadSms() {
		return L.resolveDefault(callSms(this.m.id), {}).then(r => {
			const list = Array.isArray(r.msg) ? r.msg : [];
			const groups = {};
			list.forEach(m => {
				const key = m.total > 1 ? m.sender + '#' + m.reference + '#' + m.total : 'i' + m.index;
				(groups[key] = groups[key] || []).push(m);
			});
			this.st.sms = Object.values(groups).map(parts => {
				parts.sort((a, b) => (a.part || 0) - (b.part || 0));
				return {
					sender: parts[0].sender,
					ts: Math.max.apply(null, parts.map(p => +p.timestamp || 0)),
					text: parts.map(p => p.content || '').join(''),
					idx: parts.map(p => String(p.index))
				};
			}).sort((a, b) => b.ts - a.ts);
			this.paintSms();
		});
	},

	paintSms() {
		const box = this.q('.xm-sms-list');
		box.innerHTML = '';
		const list = this.st.sms.slice(0, 3);

		if (!list.length) {
			box.appendChild(E('p', { 'class': 'xm-sms-empty' }, [ T('Входящих SMS нет.', 'No incoming SMS.') ]));
			return;
		}

		list.forEach(m => {
			const del = E('button', { 'type': 'button', 'class': 'xm-sms-del', 'aria-label': T('Удалить сообщение', 'Delete message'), 'title': T('Удалить', 'Delete'),
				'click': ev => { ev.stopPropagation(); this.deleteSms(m, ev.currentTarget); } }, [ x.icon(ICON.trash), E('span', {}, [ T('Удалить?', 'Delete?') ]) ]);
			box.appendChild(E('article', { 'class': 'xm-sms', 'tabindex': 0,
				'click': ev => ev.currentTarget.classList.toggle('xm-open'),
				'keydown': ev => { if (ev.key == 'Enter') ev.currentTarget.classList.toggle('xm-open'); } }, [
				E('span', { 'class': 'xm-sms-av', 'aria-hidden': 'true' }, [ String(m.sender || '?').replace(/^\+/, '').slice(0, 1).toUpperCase() ]),
				E('div', { 'class': 'xm-sms-main' }, [
					E('div', { 'class': 'xm-sms-top' }, [ E('b', {}, [ m.sender || T('Без отправителя', 'No sender') ]), E('small', {}, [ when(m.ts) ]) ]),
					E('p', { 'class': 'xm-sms-text' }, [ m.text ])
				]),
				del
			]));
		});
	},

	deleteSms(m, btn) {
		if (!btn.classList.contains('xm-confirm')) {
			btn.classList.add('xm-confirm');
			window.setTimeout(() => btn.classList.remove('xm-confirm'), 3500);
			return;
		}
		const row = btn.closest('.xm-sms');
		row.classList.add('xm-going');

		/* highest index first, so the others keep their numbers */
		const idx = m.idx.slice().sort((a, b) => b - a);
		const run = idx.reduce((p, i) => p.then(() => L.resolveDefault(callDelSms(this.m.id, i), null)), Promise.resolve());

		later(run, 350).then(() => this.loadSms()).then(() => {
			x.toast(T('Сообщение от ', 'Message from ') + (m.sender || '?') + T(' удалено.', ' deleted.'), 'ok');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
