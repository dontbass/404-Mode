/* 404 Mode — phone app: reads /cgi-bin/404status every few seconds.
   https://github.com/dontbass/404-Mode — Apache-2.0 */
'use strict';

(function () {
	const KEY = '404mode.token';
	const LAST = '404mode.last';
	const API = '/cgi-bin/404status';
	const EVERY = 3000;

	const $ = id => document.getElementById(id);
	const store = {
		get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
	};

	/* ---------- token: from the QR link (#t=…) or typed in ---------- */
	const hash = /[#&]t=([0-9a-f]{32})/i.exec(location.hash);
	if (hash) {
		store.set(KEY, hash[1].toLowerCase());
		history.replaceState(null, '', location.pathname);
	}

	let token = store.get(KEY);
	let last = null, lastAt = 0, timer = null, busy = false, failed = 0;

	try {
		const saved = JSON.parse(store.get(LAST) || 'null');
		if (saved && saved.d) { last = saved.d; lastAt = saved.at; }
	} catch (e) {}

	/* ---------- formatting ---------- */
	const minus = n => String(n).replace('-', '−');
	const rate = b => {
		if (b == null) return '—';
		if (b < 1024) return b + ' Б/с';
		if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' КБ/с';
		return (b / 1048576).toFixed(1) + ' МБ/с';
	};
	const dur = s => {
		if (s == null) return '—';
		const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
		return d ? d + ' д ' + h + ' ч' : (h ? h + ' ч ' + m + ' мин' : m + ' мин');
	};
	const ago = ms => {
		const s = Math.max(0, Math.round(ms / 1000));
		if (s < 60) return s + ' с';
		if (s < 3600) return Math.floor(s / 60) + ' мин';
		return Math.floor(s / 3600) + ' ч';
	};
	const delayClass = ms => !ms ? '' : (ms < 150 ? 'ok' : (ms < 400 ? 'warn' : 'bad'));
	const MODES = { rule: 'по правилам', global: 'весь трафик', direct: 'напрямую' };

	/* country flag: an emoji already in the name, or the country it names */
	const NAMES = {
		FI: 'финлянд|finland|helsinki|хельсинк', SE: 'швец|sweden|stockholm', NO: 'норвег|norway|oslo', DK: 'дани|denmark',
		NL: 'нидерланд|голланд|netherlands|amsterdam|амстердам', DE: 'герман|germany|frankfurt|франкфурт|berlin',
		RU: 'росси|russia|moscow|москв', EE: 'эстон|estonia|tallinn', LT: 'литв|lithuania', LV: 'латв|latvia|riga',
		AT: 'австри|austria|vienna', HU: 'венгр|hungary', BG: 'болгар|bulgaria', AM: 'армен|armenia', FR: 'франц|france|paris',
		IT: 'итал|italy|milan', IE: 'ирланд|ireland', BE: 'бельги|belgium', RO: 'румын|romania', MD: 'молдов|moldova',
		PL: 'польш|poland|warsaw', UA: 'украин|ukrain', JP: 'япон|japan|tokyo', CH: 'швейцар|switzerland|zurich',
		TR: 'турц|turkey|türkiye|istanbul|стамбул', KZ: 'казах|kazakh|almaty|алмат', US: 'сша|америк|usa|united states|new york',
		GB: 'британ|англи|britain|england|united kingdom|london|лондон', CA: 'канад|canada|toronto', SG: 'сингапур|singapore',
		HK: 'гонконг|hong kong', CZ: 'чехи|czech|prague', ES: 'испан|spain|madrid', GE: 'грузи|georgia|tbilisi',
		AE: 'оаэ|эмират|emirates|dubai|дубай', BY: 'беларус|белорус|belarus|minsk', RS: 'серби|serbia|belgrade'
	};
	function flag(name) {
		const s = String(name || '');
		const m = /[\u{1F1E6}-\u{1F1FF}]{2}/u.exec(s);
		if (m) return m[0];
		const low = s.toLowerCase();
		for (const cc in NAMES)
			if (new RegExp(NAMES[cc]).test(low))
				return String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
		return '';
	}
	const bare = name => String(name || '').replace(/[\u{1F1E6}-\u{1F1FF}]{2}\s*/gu, '').trim() || name;

	function set(id, text, cls) {
		const el = $(id);
		if (!el) return;
		text = text == null || text === '' ? '—' : String(text);
		if (el.textContent !== text) {
			el.textContent = text;
			if (lastAt) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
		}
		if (cls !== undefined) el.className = cls + (el.classList.contains('tick') ? ' tick' : '');
	}

	/* ---------- paint ---------- */
	function paint(d) {
		$('setup').hidden = true;
		$('cards').hidden = false;

		const s = d.sys || {};
		set('host', s.host || 'Роутер');
		set('model', s.model || '');

		const n = d.net || {};
		$('net').classList.toggle('down', !n.online);
		set('netState', n.online ? 'Интернет есть' : 'Нет интернета');
		set('netVia', n.via ? 'через ' + n.via : '');
		set('netPing', n.ping != null ? n.ping + ' мс' : '—', n.ping == null ? '' : delayClass(n.ping));
		set('netDown', rate(n.down));
		set('netUp', rate(n.up));

		const p = d.proxy || {};
		const px = $('proxy');
		px.hidden = !p.installed;
		if (p.installed) {
			set('pxMode', p.running ? (MODES[p.mode] || p.mode || '') : 'выключен');
			if (!p.running) {
				$('pxFlag').textContent = '';
				set('pxNode', 'Прокси выключен');
				set('pxDelay', '');
				set('pxChain', 'Трафик идёт напрямую');
			}
			else if (p.direct) {
				$('pxFlag').textContent = '';
				set('pxNode', 'Напрямую');
				set('pxDelay', '');
				set('pxChain', 'Режим «напрямую»: прокси не используется');
			}
			else {
				$('pxFlag').textContent = flag(p.node);
				set('pxNode', bare(p.node));
				set('pxDelay', p.delay ? p.delay + ' мс' : 'нет ответа', 'ms ' + (p.delay ? delayClass(p.delay) : 'bad'));
				set('pxChain', [ (p.chain || []).slice(0, -1).map(bare).join(' › '), p.type ].filter(Boolean).join(' · '));
			}
		}

		const c = d.cell || {};
		const cell = $('cell');
		cell.hidden = !c.present;
		if (c.present) {
			set('cKind', c.kind || '');
			const bars = c.bars == null ? 0 : c.bars;
			$('cBars').querySelectorAll('i').forEach((b, i) => b.classList.toggle('on', i < bars));
			set('cRsrp', c.rsrp != null ? minus(c.rsrp) : '—', c.rsrp == null ? '' : (c.rsrp >= -95 ? 'ok' : (c.rsrp >= -110 ? 'warn' : 'bad')));
			set('cOp', c.operator || (c.online ? '—' : 'Нет сети'));
			set('cCombo', c.combo || '');
			set('cSinr', c.sinr != null ? minus(c.sinr) : '—');
			set('cRsrq', c.rsrq != null ? minus(c.rsrq) : '—');
			set('cSim', c.sim ? c.sim + (c.sim_ready ? '' : ' !') : '—');
			set('cTemp', c.temp != null ? Math.round(c.temp) + '°' : '—');
			const note = $('cNote');
			note.hidden = !c.ca_idle && c.online !== false;
			note.textContent = c.online === false ? 'Модем не в сети' : 'Вторая несущая настроена, сейчас без трафика';
		}

		set('sUp', dur(s.uptime));
		set('sLoad', s.load != null ? s.load.toFixed(2) : '—');
		set('sMem', s.mem_total ? Math.round(100 * s.mem_used / s.mem_total) + '%' : '—');
		set('sTemp', s.temp != null ? Math.round(s.temp) + '°' : '—');
	}

	function freshness() {
		const f = $('fresh');
		if (!lastAt) { $('age').textContent = '…'; return; }
		const age = Date.now() - lastAt;
		$('age').textContent = age < 4000 ? 'сейчас' : ago(age) + ' назад';
		f.classList.toggle('stale', failed > 0 && age < 60000);
		f.classList.toggle('off', failed > 0 && age >= 60000);
	}

	function showSetup(msg) {
		$('cards').hidden = true;
		$('banner').hidden = true;
		$('setup').hidden = false;
		const e = $('setupErr');
		e.hidden = !msg;
		e.textContent = msg || '';
	}

	/* ---------- fetch loop ---------- */
	async function load() {
		if (!token) { showSetup(); return; }
		if (busy) return;
		busy = true;
		$('fresh').classList.add('busy');

		try {
			const ctl = new AbortController();
			const t = setTimeout(() => ctl.abort(), 12000);
			const r = await fetch(API, { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store', signal: ctl.signal });
			clearTimeout(t);

			if (r.status == 403) {
				store.set(KEY, null);
				token = null;
				showSetup('Ключ не подошёл: на роутере его сменили. Отсканируйте QR-код заново.');
				return;
			}
			const d = await r.json();
			if (d.error) throw new Error(d.error);

			last = d;
			lastAt = Date.now();
			failed = 0;
			store.set(LAST, JSON.stringify({ d: d, at: lastAt }));
			$('banner').hidden = true;
			paint(d);
		}
		catch (e) {
			failed++;
			if (last) {
				const b = $('banner');
				b.hidden = false;
				b.textContent = 'Роутер не отвечает. Показаны данные ' + ago(Date.now() - lastAt) + ' назад. Телефон должен быть в домашней сети Wi-Fi.';
			}
			else {
				showSetup('Роутер не отвечает. Проверьте, что телефон в домашней сети Wi-Fi.');
			}
		}
		finally {
			busy = false;
			$('fresh').classList.remove('busy');
			freshness();
		}
	}

	function start() {
		stop();
		load();
		timer = setInterval(load, EVERY);
	}
	function stop() {
		if (timer) clearInterval(timer);
		timer = null;
	}

	document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
	$('fresh').addEventListener('click', load);
	setInterval(freshness, 1000);

	$('setupForm').addEventListener('submit', ev => {
		ev.preventDefault();
		const v = $('tokenIn').value.trim().toLowerCase().replace(/^.*[#&]t=/, '');
		if (!/^[0-9a-f]{32}$/.test(v)) {
			showSetup('Ключ — 32 символа, цифры и буквы a–f.');
			return;
		}
		token = v;
		store.set(KEY, v);
		start();
	});

	if (last) paint(last);
	if (token) start(); else showSetup();
	freshness();

	if ('serviceWorker' in navigator && window.isSecureContext)
		navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
})();
