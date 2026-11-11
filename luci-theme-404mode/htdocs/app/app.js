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
		px.classList.toggle('off', !p.running || !!p.direct);
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

		/* Android: hand the address and the key to the widget app */
		if (/Android/i.test(navigator.userAgent) && token) {
			const host = s.lan || location.host;
			const fallback = 'https://github.com/dontbass/404-Mode/releases/tag/android-widget';
			const w = $('widget');
			w.href = 'intent://setup?h=' + encodeURIComponent(host) + '&t=' + token +
				'#Intent;scheme=router404;package=io.github.dontbass.router404;S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';
			w.hidden = false;
			$('widgetHint').hidden = false;
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

	/* ---------- theme: auto / dark / light, remembered on this phone ---------- */
	const THEME_KEY = '404mode.app.theme';
	const THEMES = {
		auto: { label: 'авто', icon: '<path d="M12 3a9 9 0 1 0 0 18z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>' },
		dark: { label: 'тёмная', icon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>' },
		light: { label: 'светлая', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>' }
	};
	const ORDER = [ 'auto', 'dark', 'light' ];

	function applyTheme(mode) {
		const root = document.documentElement;
		if (mode == 'dark' || mode == 'light') root.setAttribute('data-theme', mode);
		else root.removeAttribute('data-theme');

		const b = $('themeBtn');
		b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + THEMES[mode].icon + '</svg>';
		b.title = b.ariaLabel = 'Тема: ' + THEMES[mode].label;
		b.setAttribute('aria-label', b.title);

		/* the status bar follows the page, not only the phone */
		document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
			const sys = /light/.test(m.media) ? '#EEF2F7' : '#080B10';
			m.content = mode == 'dark' ? '#080B10' : (mode == 'light' ? '#EEF2F7' : sys);
		});
	}

	let theme = store.get(THEME_KEY);
	if (!THEMES[theme]) theme = 'auto';
	applyTheme(theme);
	$('themeBtn').addEventListener('click', () => {
		theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
		store.set(THEME_KEY, theme == 'auto' ? null : theme);
		applyTheme(theme);
		toast('Тема: ' + THEMES[theme].label);
	});

	/* ---------- toast ---------- */
	let toastTimer = null;
	function toast(text, bad) {
		const t = $('toast');
		t.textContent = text;
		t.className = 'toast' + (bad ? ' bad' : '');
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
	}

	/* ---------- the router, with the key ---------- */
	async function call(query, body) {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), 20000);
		try {
			const r = await fetch(API + (query || ''), {
				method: body ? 'POST' : 'GET',
				headers: Object.assign({ 'Authorization': 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
				body: body ? JSON.stringify(body) : undefined,
				cache: 'no-store',
				signal: ctl.signal
			});
			if (r.status == 403) throw new Error('Ключ не подошёл');
			const d = await r.json();
			if (d.error) throw new Error(d.error == 'api' ? 'mihomo не отвечает' : d.error);
			return d;
		}
		catch (e) {
			throw new Error(e.name == 'AbortError' ? 'Роутер не ответил' : e.message);
		}
		finally {
			clearTimeout(timer);
		}
	}

	/* ---------- node picker ---------- */
	const KIND = { Selector: 'ручной выбор', URLTest: 'авто по задержке', Fallback: 'резерв по порядку', LoadBalance: 'балансировка', Relay: 'цепочка' };
	const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
	const SPIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9"/></svg>';
	const MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
	let px = null, path = [], sheetOpen = false;

	const group = name => px && (px.groups || []).find(g => g.name == name);
	const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

	function openSheet() {
		if (sheetOpen || !last || !last.proxy || !last.proxy.running || last.proxy.direct) return;
		sheetOpen = true;
		$('sheetBack').hidden = false;
		$('sheet').hidden = false;
		$('sheetBack').classList.remove('out');
		$('sheet').classList.remove('out');
		history.pushState({ sheet: 1 }, '');
		$('sheetTitle').textContent = 'Прокси';
		$('sheetSub').textContent = 'Загружаем ноды…';
		$('nodes').innerHTML = '<li class="empty">Спрашиваем mihomo…</li>';
		$('sheetFilter').hidden = true;
		$('sheetAuto').hidden = true;
		$('sheetUp').hidden = true;

		call('?a=proxies').then(d => {
			px = d;
			if (!d.api) throw new Error('mihomo не отвечает');
			path = [ d.main ];
			renderSheet();
		}).catch(e => {
			$('sheetSub').textContent = '';
			$('nodes').innerHTML = '<li class="empty">' + esc(e.message) + '</li>';
		});
	}

	function closeSheet(fromHistory) {
		if (!sheetOpen) return;
		sheetOpen = false;
		$('sheet').classList.add('out');
		$('sheetBack').classList.add('out');
		setTimeout(() => { $('sheet').hidden = true; $('sheetBack').hidden = true; }, 220);
		$('sheetFilter').value = '';
		if (!fromHistory && history.state && history.state.sheet) history.back();
	}

	function renderSheet() {
		const g = group(path[path.length - 1]);
		if (!g) return;
		const auto = g.type == 'URLTest' || g.type == 'Fallback';

		$('sheetTitle').textContent = bare(g.name);
		$('sheetSub').textContent = [ KIND[g.type] || g.type, g.all.length + ' ' + plural(g.all.length, 'вариант', 'варианта', 'вариантов') ].join(' · ');
		$('sheetUp').hidden = path.length < 2;

		const a = $('sheetAuto');
		a.hidden = !auto;
		a.classList.toggle('on', auto && !g.fixed);
		a.textContent = !g.fixed ? 'Автовыбор включён · сейчас ' + bare(g.now) : 'Выбирать автоматически';

		const f = $('sheetFilter');
		f.hidden = g.all.length <= 10;
		const q = f.value.trim().toLowerCase();

		const list = g.all.filter(o => !q || o.name.toLowerCase().includes(q));
		$('nodes').innerHTML = list.length ? list.map(o => {
			const sel = o.name == g.now;
			const isGroup = o.group;
			const sub = isGroup
				? 'группа' + (group(o.name) ? ' · сейчас ' + bare(group(o.name).now) : '')
				: [ o.type, auto && g.fixed == o.name ? 'закреплена' : '' ].filter(Boolean).join(' · ');
			const fl = isGroup ? '<span class="flag grp" aria-hidden="true">◎</span>' : '<span class="flag" aria-hidden="true">' + (flag(o.name) || '·') + '</span>';
			const ms = o.delay ? '<span class="ms ' + delayClass(o.delay) + '">' + o.delay + ' мс</span>' : '<span class="ms none">—</span>';
			return '<li class="node" role="option" tabindex="0" aria-selected="' + sel + '" data-name="' + esc(o.name) + '">' +
				fl + '<span class="node-name"><b>' + esc(bare(o.name)) + '</b><small>' + esc(sub) + '</small></span>' + ms +
				(isGroup ? '<button class="icon-btn" type="button" data-open="' + esc(o.name) + '" aria-label="Открыть группу">' + MORE + '</button>'
				         : '<span class="mark">' + (sel ? CHECK : '') + '</span>') +
				'</li>';
		}).join('') : '<li class="empty">Ничего не нашлось</li>';
	}

	function plural(n, one, few, many) {
		const a = n % 10, b = n % 100;
		return a == 1 && b != 11 ? one : (a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many);
	}

	async function choose(li) {
		const g = group(path[path.length - 1]);
		const name = li.getAttribute('data-name');
		if (!g || name == g.now && (g.type == 'Selector' || g.fixed == name)) return;
		li.classList.add('busy');
		const mark = li.querySelector('.mark');
		if (mark) mark.innerHTML = SPIN;
		try {
			await call('', { action: 'select', group: g.name, name: name });
			g.now = name;
			if (g.type != 'Selector') g.fixed = name;
			renderSheet();
			toast('Подключено: ' + bare(name));
			load();
		}
		catch (e) {
			li.classList.remove('busy');
			if (mark) mark.innerHTML = '';
			toast('Не переключилось: ' + e.message, true);
		}
	}

	$('proxy').addEventListener('click', openSheet);
	$('proxy').addEventListener('keydown', ev => { if (ev.key == 'Enter' || ev.key == ' ') { ev.preventDefault(); openSheet(); } });
	$('sheetBack').addEventListener('click', () => closeSheet());
	$('sheetClose').addEventListener('click', () => closeSheet());
	window.addEventListener('popstate', () => closeSheet(true));
	document.addEventListener('keydown', ev => { if (ev.key == 'Escape') closeSheet(); });

	$('sheetUp').addEventListener('click', () => {
		path.pop();
		$('sheetFilter').value = '';
		renderSheet();
	});

	$('nodes').addEventListener('click', ev => {
		const open = ev.target.closest('[data-open]');
		if (open) {
			path.push(open.getAttribute('data-open'));
			$('sheetFilter').value = '';
			renderSheet();
			$('nodes').scrollTop = 0;
			return;
		}
		const li = ev.target.closest('.node');
		if (li) choose(li);
	});
	$('nodes').addEventListener('keydown', ev => {
		const li = ev.target.closest('.node');
		if (li && ev.key == 'Enter') choose(li);
	});

	$('sheetFilter').addEventListener('input', renderSheet);

	$('sheetAuto').addEventListener('click', async () => {
		const g = group(path[path.length - 1]);
		if (!g || !g.fixed) return;
		try {
			await call('', { action: 'unfix', group: g.name });
			g.fixed = '';
			renderSheet();
			toast('Автовыбор включён');
			setTimeout(load, 800);
		}
		catch (e) { toast('Не получилось: ' + e.message, true); }
	});

	$('sheetPing').addEventListener('click', async () => {
		const g = group(path[path.length - 1]);
		const b = $('sheetPing');
		if (!g || b.classList.contains('spin')) return;
		b.classList.add('spin');
		try {
			const r = await call('', { action: 'group_delay', group: g.name });
			const delays = r.delays || {};
			let alive = 0;
			g.all.forEach(o => {
				if (o.name in delays) { o.delay = delays[o.name] || 0; if (o.delay) alive++; }
				else if (!o.group) o.delay = 0;
			});
			renderSheet();
			toast('Отвечают ' + alive + ' из ' + g.all.length);
		}
		catch (e) { toast('Проверка не прошла: ' + e.message, true); }
		finally { b.classList.remove('spin'); }
	});

	/* a new version took over: show it right away instead of on the next launch */
	if ('serviceWorker' in navigator && window.isSecureContext) {
		const had = !!navigator.serviceWorker.controller;
		navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); });
		navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' })
			.then(r => r.update())
			.catch(() => {});
	}
})();
