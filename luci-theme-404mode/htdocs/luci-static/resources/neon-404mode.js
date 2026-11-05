'use strict';
'require baseclass';
'require rpc';

/*
 * 404 Mode — shared helpers for the dashboard and the proxy panel:
 * wording (ru / en), number formats, flags, Nikki RPC, small widgets.
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const RU = (document.documentElement.lang || '').slice(0, 2) == 'ru';

const callProxy = rpc.declare({ object: '404mode', method: 'proxy', expect: { '': {} } });
const callProxySet = rpc.declare({ object: '404mode', method: 'proxy_set', params: [ 'action', 'group', 'name', 'mode', 'on' ], expect: { '': {} } });

/* flags of the countries proxy nodes usually sit in, drawn as 3:2 SVG */
const nordic = (bg, cross, inner) => '<rect width="30" height="20" fill="' + bg + '"/><path d="M0 10h30M11 0v20" stroke="' + cross + '" stroke-width="' + (inner ? 5 : 4) + '"/>' + (inner ? '<path d="M0 10h30M11 0v20" stroke="' + inner + '" stroke-width="2.4"/>' : '');
const hband = (a, b, c) => '<rect width="30" height="20" fill="' + c + '"/><rect width="30" height="13.34" fill="' + b + '"/><rect width="30" height="6.67" fill="' + a + '"/>';
const vband = (a, b, c) => '<rect width="30" height="20" fill="' + b + '"/><rect width="10" height="20" fill="' + a + '"/><rect x="20" width="10" height="20" fill="' + c + '"/>';

const FLAGS = {
	FI: nordic('#fff', '#18407E'),
	SE: nordic('#006AA7', '#FECC00'),
	NO: nordic('#BA0C2F', '#fff', '#00205B'),
	DK: nordic('#C8102E', '#fff'),
	IS: nordic('#02529C', '#fff', '#DC1E35'),
	NL: hband('#AE1C28', '#fff', '#21468B'),
	DE: hband('#000', '#DD0000', '#FFCE00'),
	RU: hband('#fff', '#0039A6', '#D52B1E'),
	EE: hband('#0072CE', '#000', '#fff'),
	LT: hband('#FDB913', '#006A44', '#C1272D'),
	AT: hband('#C8102E', '#fff', '#C8102E'),
	HU: hband('#CE2939', '#fff', '#477050'),
	BG: hband('#fff', '#00966E', '#D62612'),
	AM: hband('#D90012', '#0033A0', '#F2A800'),
	LV: '<rect width="30" height="20" fill="#9E3039"/><rect y="8" width="30" height="4" fill="#fff"/>',
	FR: vband('#002395', '#fff', '#ED2939'),
	IT: vband('#009246', '#fff', '#CE2B37'),
	IE: vband('#169B62', '#fff', '#FF883E'),
	BE: vband('#000', '#FDDA24', '#EF3340'),
	RO: vband('#002B7F', '#FCD116', '#CE1126'),
	MD: vband('#0046AE', '#FFD200', '#CC092F'),
	PL: '<rect width="30" height="20" fill="#DC143C"/><rect width="30" height="10" fill="#fff"/>',
	UA: '<rect width="30" height="20" fill="#FFD700"/><rect width="30" height="10" fill="#0057B7"/>',
	JP: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#BC002D"/>',
	CH: '<rect width="30" height="20" fill="#DA291C"/><path d="M15 5v10M10 10h10" stroke="#fff" stroke-width="3.2"/>',
	TR: '<rect width="30" height="20" fill="#E30A17"/><circle cx="12" cy="10" r="5" fill="#fff"/><circle cx="13.3" cy="10" r="4" fill="#E30A17"/><circle cx="18.2" cy="10" r="1.6" fill="#fff"/>',
	KZ: '<rect width="30" height="20" fill="#00AFCA"/><circle cx="15" cy="9.5" r="3.6" fill="#FEC50C"/>',
	US: '<rect width="30" height="20" fill="#fff"/>' + [0, 2, 4, 6, 8, 10, 12].map(i => '<rect y="' + (i * 20 / 13) + '" width="30" height="' + (20 / 13) + '" fill="#B22234"/>').join('') + '<rect width="13" height="10.8" fill="#3C3B6E"/>',
	GB: '<rect width="30" height="20" fill="#012169"/><path d="M0 0l30 20M30 0 0 20" stroke="#fff" stroke-width="4"/><path d="M0 0l30 20M30 0 0 20" stroke="#C8102E" stroke-width="1.6"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#C8102E" stroke-width="3.4"/>',
	CA: '<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#D52B1E"/><rect x="22.5" width="7.5" height="20" fill="#D52B1E"/><path d="M15 5l1.4 3 2-.6-.8 3.2 1.6.4-2.6 2.2.4 1.6H15.6V17h-1.2v-2.2H12l.4-1.6-2.6-2.2 1.6-.4-.8-3.2 2 .6z" fill="#D52B1E"/>',
	SG: '<rect width="30" height="20" fill="#fff"/><rect width="30" height="10" fill="#EF3340"/><circle cx="7" cy="5" r="3" fill="#fff"/><circle cx="8.2" cy="5" r="2.8" fill="#EF3340"/>',
	HK: '<rect width="30" height="20" fill="#DE2910"/><circle cx="15" cy="10" r="4" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="2.4 2.6"/>',
	CZ: '<rect width="30" height="20" fill="#D7141A"/><rect width="30" height="10" fill="#fff"/><path d="M0 0l14 10L0 20z" fill="#11457E"/>',
	ES: '<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>',
	GE: '<rect width="30" height="20" fill="#fff"/><path d="M15 0v20M0 10h30" stroke="#FF0000" stroke-width="4"/>',
	AE: '<rect width="30" height="20" fill="#000"/><rect width="30" height="13.34" fill="#fff"/><rect width="30" height="6.67" fill="#00732F"/><rect width="8" height="20" fill="#FF0000"/>',
	BY: '<rect width="30" height="20" fill="#4AA657"/><rect width="30" height="13.3" fill="#C8313E"/><rect width="4" height="20" fill="#fff"/>',
	BR: '<rect width="30" height="20" fill="#009C3B"/><path d="M15 3 27 10 15 17 3 10z" fill="#FFDF00"/><circle cx="15" cy="10" r="4.2" fill="#002776"/>',
	IN: hband('#FF9933', '#fff', '#138808') + '<circle cx="15" cy="10" r="2.4" fill="none" stroke="#000080" stroke-width=".8"/>',
	PT: '<rect width="30" height="20" fill="#FF0000"/><rect width="12" height="20" fill="#006600"/><circle cx="12" cy="10" r="3.4" fill="#FFCC00"/>',
	AU: '<rect width="30" height="20" fill="#00247D"/><path d="M0 0l13 9M13 0 0 9" stroke="#fff" stroke-width="2.4"/><path d="M6.5 0v9M0 4.5h13" stroke="#fff" stroke-width="3"/><path d="M6.5 0v9M0 4.5h13" stroke="#CF142B" stroke-width="1.6"/>',
	KR: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5" fill="#CD2E3A"/><path d="M10 10a5 5 0 0 0 10 0 2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 1-5 0" fill="#0047A0"/>',
	TW: '<rect width="30" height="20" fill="#FE0000"/><rect width="15" height="10" fill="#000095"/><circle cx="7.5" cy="5" r="2.4" fill="#fff"/>',
	SK: hband('#fff', '#0B4EA2', '#EE1C25'),
	SI: hband('#fff', '#0000FF', '#FF0000'),
	RS: hband('#C6363C', '#0C4076', '#fff'),
	HR: hband('#FF0000', '#fff', '#171796'),
	LU: hband('#ED2939', '#fff', '#00A1DE'),
	AZ: hband('#0092BC', '#E4002B', '#00AF66'),
	UZ: hband('#0099B5', '#fff', '#1EB53A'),
	KG: '<rect width="30" height="20" fill="#E8112D"/><circle cx="15" cy="10" r="3.6" fill="#FFEF00"/>',
	GR: '<rect width="30" height="20" fill="#0D5EAF"/>' + [1, 3, 5, 7].map(i => '<rect y="' + (i * 20 / 9) + '" width="30" height="' + (20 / 9) + '" fill="#fff"/>').join('') + '<rect width="11" height="11.1" fill="#0D5EAF"/><path d="M5.5 0v11.1M0 5.55h11" stroke="#fff" stroke-width="2.2"/>',
	IL: '<rect width="30" height="20" fill="#fff"/><rect y="2.5" width="30" height="3" fill="#0038B8"/><rect y="14.5" width="30" height="3" fill="#0038B8"/><path d="M15 6.5l3 5.2h-6zM15 13.5l-3-5.2h6z" fill="none" stroke="#0038B8" stroke-width=".9"/>',
	CN: '<rect width="30" height="20" fill="#DE2910"/><circle cx="6" cy="6" r="2.6" fill="#FFDE00"/>',
	VN: '<rect width="30" height="20" fill="#DA251D"/><circle cx="15" cy="10" r="4" fill="#FFFF00"/>',
	TH: '<rect width="30" height="20" fill="#A51931"/><rect y="3.3" width="30" height="13.4" fill="#F4F5F8"/><rect y="6.7" width="30" height="6.6" fill="#2D2A4A"/>',
	MX: vband('#006847', '#fff', '#CE1126'),
	AR: hband('#74ACDF', '#fff', '#74ACDF')
};

/* country names in node titles, for subscriptions without flag emoji */
const NAMES = {
	FI: 'финлянд|finland|helsinki|хельсинк', SE: 'швец|sweden|stockholm', NO: 'норвег|norway|oslo', DK: 'дани|denmark',
	NL: 'нидерланд|голланд|netherlands|amsterdam|амстердам', DE: 'герман|germany|frankfurt|франкфурт|berlin',
	RU: 'росси|russia|moscow|москв', EE: 'эстон|estonia|tallinn', LT: 'литв|lithuania|vilnius', LV: 'латв|latvia|riga',
	AT: 'австри|austria|vienna', HU: 'венгр|hungary', BG: 'болгар|bulgaria', AM: 'армен|armenia', FR: 'франц|france|paris',
	IT: 'итал|italy|milan', IE: 'ирланд|ireland', BE: 'бельги|belgium', RO: 'румын|romania', MD: 'молдов|moldova',
	PL: 'польш|poland|warsaw', UA: 'украин|ukrain', JP: 'япон|japan|tokyo', CH: 'швейцар|switzerland|zurich',
	TR: 'турц|turkey|türkiye|istanbul|стамбул', KZ: 'казах|kazakh|almaty|алмат', US: 'сша|америк|usa|united states|new york|los angeles',
	GB: 'британ|англи|britain|england|united kingdom|london|лондон|\\buk\\b', CA: 'канад|canada|toronto', SG: 'сингапур|singapore',
	HK: 'гонконг|hong kong', CZ: 'чехи|czech|prague', ES: 'испан|spain|madrid', GE: 'грузи|georgia|tbilisi', AE: 'оаэ|эмират|emirates|dubai|дубай',
	BY: 'беларус|белорус|belarus|minsk|минск', BR: 'бразил|brazil', IN: 'инди|india|mumbai', PT: 'португал|portugal|lisbon',
	AU: 'австрал|australia|sydney', KR: 'коре|korea|seoul', TW: 'тайван|taiwan', SK: 'словаки|slovakia', SI: 'словени|slovenia',
	RS: 'серби|serbia|belgrade', HR: 'хорвати|croatia', LU: 'люксембург|luxembourg', AZ: 'азербайджан|azerbaijan|baku', UZ: 'узбек|uzbek|tashkent',
	KG: 'киргиз|кыргыз|kyrgyz|bishkek', GR: 'греци|greece|athens', IL: 'израил|israel', CN: 'китай|china|beijing|shanghai',
	VN: 'вьетнам|vietnam', TH: 'таиланд|тайланд|thailand|bangkok', MX: 'мексик|mexico', AR: 'аргентин|argentina'
};

const PLMN = {
	'25001': [ 'МТС', 'MTS' ], '25002': [ 'МегаФон', 'MegaFon' ], '25099': [ 'Билайн', 'Beeline' ], '25028': [ 'Билайн', 'Beeline' ],
	'25020': [ 'T2', 'T2' ], '25011': [ 'Yota', 'Yota' ], '25062': [ 'Т-Мобайл', 'T-Mobile' ], '25035': [ 'Мотив', 'Motiv' ],
	'25039': [ 'Ростелеком', 'Rostelecom' ], '25027': [ 'Летай', 'Letai' ], '25032': [ 'Win mobile', 'Win mobile' ],
	'25060': [ 'Волна мобайл', 'Volna mobile' ], '25701': [ 'A1', 'A1' ], '25702': [ 'МТС', 'MTS' ], '25704': [ 'life:)', 'life:)' ],
	'40101': [ 'Beeline', 'Beeline' ], '40102': [ 'Kcell', 'Kcell' ], '40107': [ 'Altel', 'Altel' ], '40177': [ 'Tele2', 'Tele2' ]
};

/* COPS long names → how people call them */
const BRANDS = [
	[ /megafon|мегафон/i, 'МегаФон', 'MegaFon' ], [ /mts|мтс/i, 'МТС', 'MTS' ], [ /beeline|билайн/i, 'Билайн', 'Beeline' ],
	[ /tele2|^t2/i, 'T2', 'T2' ], [ /yota/i, 'Yota', 'Yota' ], [ /motiv|мотив/i, 'Мотив', 'Motiv' ], [ /rostelecom/i, 'Ростелеком', 'Rostelecom' ]
];

function flagCode(name) {
	const cps = Array.from(String(name || ''));

	for (let i = 0; i < cps.length - 1; i++) {
		const a = cps[i].codePointAt(0), b = cps[i + 1].codePointAt(0);
		if (a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF)
			return String.fromCharCode(a - 0x1F1E6 + 65, b - 0x1F1E6 + 65);
	}

	const low = String(name || '').toLowerCase();
	for (const code in NAMES)
		if (new RegExp(NAMES[code]).test(low))
			return code;

	const m = /(?:^|[^a-z])([a-z]{2})(?:[-_ ]?\d+)?(?:$|[^a-z])/i.exec(String(name || ''));
	return (m && FLAGS[m[1].toUpperCase()]) ? m[1].toUpperCase() : null;
}

return baseclass.extend({
	RU: RU,

	t(ru, en) { return RU ? ru : en; },

	css() {
		if (!document.querySelector('link[data-404view]'))
			document.head.appendChild(E('link', { 'rel': 'stylesheet', 'data-404view': '1', 'href': L.resource('view/404mode/neon.css') + '?v=1.8.6' }));
	},

	num(v, d) {
		return (+v).toLocaleString(RU ? 'ru-RU' : 'en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
	},

	minus(v) {
		return v < 0 ? '−' + Math.abs(v) : String(v);
	},

	bytes(n) {
		const u = RU ? [ 'Б', 'КБ', 'МБ', 'ГБ', 'ТБ' ] : [ 'B', 'KB', 'MB', 'GB', 'TB' ];
		let i = 0;
		n = +n || 0;
		while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
		return [ this.num(n, i >= 3 ? 1 : (i ? 0 : 0)), u[i] ];
	},

	rate(bps) {
		const mbit = (+bps || 0) * 8 / 1e6;
		if (mbit >= 1)
			return [ this.num(mbit, mbit < 10 ? 1 : 0), this.t('Мбит/с', 'Mbit/s') ];
		return [ this.num(mbit * 1000, 0), this.t('кбит/с', 'kbit/s') ];
	},

	duration(t) {
		t = Math.max(0, Math.floor(+t || 0));
		const d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60);
		if (d)
			return this.t(d + ' д ' + h + ' ч', d + 'd ' + h + 'h');
		if (h)
			return this.t(h + ' ч ' + m + ' мин', h + 'h ' + m + 'm');
		return this.t(m + ' мин', m + 'm');
	},

	operator(isp, plmn) {
		const raw = String(isp || '').trim();
		const code = (/^\d{5,6}$/.test(raw) ? raw : '') || String(plmn || '');

		if (PLMN[code])
			return PLMN[code][RU ? 0 : 1];

		for (const b of BRANDS)
			if (b[0].test(raw))
				return b[RU ? 1 : 2];

		return raw || null;
	},

	/* "🇫🇮 Finland-01 | VLESS" → "Finland-01" */
	nodeName(name) {
		return String(name || '').replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/^[\s|·\-_:]+|[\s|·\-_:]+$/g, '').trim() || String(name || '');
	},

	flag(name, cls) {
		const code = flagCode(name);
		const el = E('span', { 'class': 'xf ' + (cls || ''), 'title': code || '' });

		if (code && FLAGS[code])
			el.innerHTML = '<svg viewBox="0 0 30 20" aria-hidden="true">' + FLAGS[code] + '</svg>';
		else if (code)
			el.appendChild(E('b', {}, [ code ]));
		else
			el.innerHTML = '<svg viewBox="0 0 24 24" class="xf-globe" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 3.2-3 14.8 0 18M12 3c3 3.2 3 14.8 0 18"/></svg>';

		return el;
	},

	delayClass(d) {
		if (d == null)
			return 'none';
		if (!d)
			return 'bad';
		return d < 200 ? 'ok' : (d < 500 ? 'warn' : 'bad');
	},

	delayText(d) {
		if (d == null)
			return '—';
		if (!d)
			return this.t('нет связи', 'timeout');
		return d + ' ' + this.t('мс', 'ms');
	},

	switchEl(on, label, onchange) {
		const btn = E('button', {
			'type': 'button',
			'class': 'xs',
			'role': 'switch',
			'aria-checked': on ? 'true' : 'false',
			'aria-label': label
		});

		btn.addEventListener('click', () => {
			if (btn.disabled)
				return;
			const next = btn.getAttribute('aria-checked') != 'true';
			btn.setAttribute('aria-checked', next ? 'true' : 'false');
			onchange && onchange(next, btn);
		});

		return btn;
	},

	icon(path, cls) {
		const s = E('span', { 'class': 'xi ' + (cls || ''), 'aria-hidden': 'true' });
		s.innerHTML = '<svg viewBox="0 0 24 24">' + path + '</svg>';
		return s;
	},

	proxy() {
		return L.resolveDefault(callProxy(), { installed: false });
	},

	proxySet(action, args) {
		args = args || {};
		return callProxySet(action, args.group, args.name, args.mode, args.on == null ? undefined : !!args.on);
	}
});
