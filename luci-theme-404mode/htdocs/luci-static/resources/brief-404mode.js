'use strict';
'require baseclass';
'require rpc';

/*
 * 404 Mode — header brief: weather, exchange rates, headlines
 *
 * Data comes from the router (ubus "404mode", rpcd ucode plugin), which
 * fetches Open-Meteo, the CBR daily rates and OpenNet / Habr RSS and caches
 * them. The browser keeps its own short cache in localStorage, so moving
 * between LuCI pages does not call the router every time.
 *
 * Weather also drives the ambient background: html[data-sky] (dawn / day /
 * dusk / night) and html[data-wx] (clear / cloud / rain / snow / fog /
 * storm) tint the slow gradient behind the interface.
 *
 * Click the city to change it (stored per browser).
 *
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const callWeather = rpc.declare({ object: '404mode', method: 'weather', params: [ 'city' ] });
const callRates = rpc.declare({ object: '404mode', method: 'rates' });
const callNews = rpc.declare({ object: '404mode', method: 'news' });

const RU = (document.documentElement.lang || '').substr(0, 2) == 'ru';
const ROOT = document.documentElement;

const T = RU ? {
	feels: 'ощущается', wind: 'ветер', ms: 'м/с', city: 'Город', rates: 'Курс ЦБ на',
	s_rates: 'Курс ЦБ', s_news: 'Новости', s_wx: 'Погода', locale: 'ru-RU',
	wx: { clear: 'ясно', cloud: 'облачно', fog: 'туман', drizzle: 'морось', rain: 'дождь', snow: 'снег', storm: 'гроза' }
} : {
	feels: 'feels like', wind: 'wind', ms: 'm/s', city: 'City', rates: 'CBR rate for',
	s_rates: 'CBR rates', s_news: 'Headlines', s_wx: 'Weather', locale: 'en-US',
	wx: { clear: 'clear', cloud: 'cloudy', fog: 'fog', drizzle: 'drizzle', rain: 'rain', snow: 'snow', storm: 'storm' }
};

/* default city from the browser time zone; the user can change it */
const TZ_CITY = {
	'Europe/Moscow': 'Москва', 'Europe/Kaliningrad': 'Калининград', 'Europe/Samara': 'Самара',
	'Europe/Volgograd': 'Волгоград', 'Europe/Saratov': 'Саратов', 'Europe/Ulyanovsk': 'Ульяновск',
	'Asia/Yekaterinburg': 'Екатеринбург', 'Asia/Omsk': 'Омск', 'Asia/Novosibirsk': 'Новосибирск',
	'Asia/Barnaul': 'Барнаул', 'Asia/Tomsk': 'Томск', 'Asia/Krasnoyarsk': 'Красноярск',
	'Asia/Irkutsk': 'Иркутск', 'Asia/Yakutsk': 'Якутск', 'Asia/Vladivostok': 'Владивосток',
	'Asia/Magadan': 'Магадан', 'Asia/Kamchatka': 'Петропавловск-Камчатский',
	'Europe/Minsk': 'Минск', 'Europe/Kiev': 'Киев', 'Europe/Kyiv': 'Киев', 'Asia/Almaty': 'Алматы'
};

const TTL = { wx: 15 * 60e3, rates: 30 * 60e3, news: 10 * 60e3 };

function ls(key, val) {
	try {
		if (val === undefined)
			return JSON.parse(localStorage.getItem('404mode.brief.' + key) || 'null');

		if (val === null)
			localStorage.removeItem('404mode.brief.' + key);
		else
			localStorage.setItem('404mode.brief.' + key, JSON.stringify(val));
	}
	catch (e) {}

	return null;
}

function defaultCity() {
	let tz = '';
	try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
	return TZ_CITY[tz] || (tz.indexOf('/') > 0 ? tz.split('/').pop().replace(/_/g, ' ') : (RU ? 'Москва' : 'London'));
}

/* WMO weather code → kind */
function wxKind(code) {
	if (code == 0) return 'clear';
	if (code <= 3) return 'cloud';
	if (code == 45 || code == 48) return 'fog';
	if (code >= 51 && code <= 57) return 'drizzle';
	if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
	if ((code >= 71 && code <= 77) || code == 85 || code == 86) return 'snow';
	if (code >= 95) return 'storm';
	return 'cloud';
}

const ICON = {
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
	moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
	cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z"/>',
	fog: '<path d="M4 9h16M2 13h20M5 17h14"/>',
	drizzle: '<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M9 18v1M13 18v1M17 18v1"/>',
	rain: '<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>',
	snow: '<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M9 18h.01M13 20h.01M17 18h.01M11 21h.01M15 22h.01"/>',
	storm: '<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M12 15l-2 4h3l-2 4"/>'
};

function icon(name) {
	return '<svg class="hb-ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || ICON.cloud) + '</svg>';
}

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function num(v, d) {
	return Number(v).toLocaleString(RU ? 'ru-RU' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function skyOf(wx) {
	const h = new Date().getHours();

	if (wx && wx.day === 0)
		return (h >= 4 && h < 8) ? 'dawn' : 'night';

	if (h >= 5 && h < 9) return 'dawn';
	if (h >= 9 && h < 17) return 'day';
	if (h >= 17 && h < 21) return 'dusk';
	return 'night';
}

return baseclass.extend({
	__init__() {
		this.box = document.getElementById('hud-brief');

		if (!this.box)
			return;

		this.data = { wx: null, rates: null, news: null };
		this.newsIndex = 0;

		this.box.innerHTML =
			'<div class="hb-cell hb-wx" hidden></div>' +
			'<div class="hb-fx" hidden></div>' +
			'<a class="hb-cell hb-news" target="_blank" rel="noreferrer" hidden></a>';

		this.el = {
			wx: this.box.querySelector('.hb-wx'),
			fx: this.box.querySelector('.hb-fx'),
			news: this.box.querySelector('.hb-news')
		};

		this.el.wx.addEventListener('click', ev => {
			if (ev.target.closest('.hb-city'))
				this.editCity();
		});

		ROOT.setAttribute('data-sky', skyOf(null));

		this.load('wx', () => callWeather(this.city()));
		this.load('rates', () => callRates());
		this.load('news', () => callNews());

		window.setInterval(() => {
			ROOT.setAttribute('data-sky', skyOf(this.data.wx));
			this.load('wx', () => callWeather(this.city()));
			this.load('rates', () => callRates());
			this.load('news', () => callNews());
		}, 5 * 60e3);

		window.setInterval(() => this.rotateNews(), 9000);

		/* full-screen foreign overlays (screensavers): a live board behind them */
		document.addEventListener('404mode-overlay', ev => this.attachSaver(ev.detail));
		document.querySelectorAll('[data-nfx~="overlay"]').forEach(el => this.attachSaver(el));
	},

	/* ---------- screensaver board ---------- */

	attachSaver(ov) {
		if (!ov || this.saverFor === ov)
			return;

		this.saverFor = ov;

		if (!this.saver) {
			this.saver = document.createElement('div');
			this.saver.className = 'n-saver';
			this.saver.setAttribute('aria-hidden', 'true');
			this.saver.innerHTML =
				'<div class="ns-amb"><i></i><i></i><i></i></div>' +
				'<div class="ns-wall"><div class="ns-slide"></div><div class="ns-slide"></div></div>' +
				'<div class="ns-board">' +
					'<section class="ns-panel ns-wx" hidden></section>' +
					'<section class="ns-panel ns-fx" hidden></section>' +
				'</div>';
			this.saverPage = 0;
			this.saverTick = 0;
		}

		if (!this.saverTimer)
			this.saverTimer = window.setInterval(() => this.syncSaver(), 1000);

		this.syncSaver();
	},

	/* follow the overlay: shown, hidden, re-created or gone */
	syncSaver() {
		const ov = this.saverFor;

		if (!ov || !ov.isConnected) {
			const again = document.querySelector('[data-nfx~="overlay"]');

			if (again && again !== ov) {
				this.saverFor = again;
				return this.syncSaver();
			}

			this.saver.remove();
			window.clearInterval(this.saverTimer);
			this.saverTimer = null;
			this.saverFor = null;
			return;
		}

		const cs = getComputedStyle(ov);
		const shown = cs.display != 'none' && cs.visibility != 'hidden' && parseFloat(cs.opacity) > .05;

		if (!shown) {
			ov.removeAttribute('data-nfx-saver');
			this.saver.remove();
			return;
		}

		if (this.saver.nextSibling !== ov) {
			ov.parentNode.insertBefore(this.saver, ov);
			this.saver.style.zIndex = (cs.zIndex == 'auto') ? '' : cs.zIndex;
			this.renderSaver();
		}

		ov.setAttribute('data-nfx-saver', '');
		this.layoutSaver(ov);

		/* next headline on the wallpaper every 12 s */
		if (++this.saverTick % 12 == 0)
			this.renderSaverNews(true);
	},

	/* keep the board and the headline clear of the screensaver's own
	   content: below it when there is room, else in the side columns,
	   else headline only */
	layoutSaver(ov) {
		let top = Infinity, bottom = 0, left = Infinity, right = 0;

		ov.querySelectorAll('*').forEach(el => {
			const r = el.getBoundingClientRect();

			if (r.width * r.height < 1500 || r.width > innerWidth * .95)
				return;

			top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
			left = Math.min(left, r.left); right = Math.max(right, r.right);
		});

		const st = this.saver.style;
		let mode = 'below';

		if (bottom == 0) {
			bottom = 0; left = innerWidth / 2; right = innerWidth / 2;
		}

		const below = innerHeight - bottom - 24;
		const side = Math.min(left, innerWidth - right) - 32;

		if (below >= 210)
			mode = 'below';
		else if (side >= 220)
			mode = 'sides';
		else
			mode = 'compact';

		this.saver.setAttribute('data-layout', mode);
		st.setProperty('--ns-below', Math.max(0, below) + 'px');
		st.setProperty('--ns-side', Math.max(0, side) + 'px');
	},

	renderSaver() {
		if (!this.saver)
			return;

		this.saverTick = this.saverTick || 0;

		const wx = this.data.wx, fx = this.data.rates;
		const panel = this.saver.querySelector('.ns-wx');

		if (wx && !wx.error) {
			const kind = wxKind(wx.code);
			const ico = (kind == 'clear') ? (wx.day === 0 ? 'moon' : 'sun') : kind;
			const t = Math.round(wx.t);
			const date = new Date().toLocaleDateString(T.locale, { weekday: 'long', day: 'numeric', month: 'long' });

			panel.innerHTML =
				'<div class="ns-wx-main">' + icon(ico) +
					'<span class="ns-temp">' + (t > 0 ? '+' : '') + t + '°</span></div>' +
				'<div class="ns-wx-side">' +
					'<b>' + esc(wx.city) + '</b>' +
					'<span>' + esc(T.wx[kind]) + '</span>' +
					'<span>' + esc(T.feels) + ' ' + Math.round(wx.feels) + '°, ' + esc(T.wind) + ' ' + num(wx.wind, 1) + ' ' + esc(T.ms) + '</span>' +
					'<span class="ns-date">' + esc(date) + '</span>' +
				'</div>';
			panel.hidden = false;
		}

		const fxp = this.saver.querySelector('.ns-fx');

		if (fx && fx.list && fx.list.length) {
			fxp.innerHTML = '<h4>' + esc(T.s_rates) + '</h4>' + fx.list.map(r => {
				const diff = r.v - r.p;
				const dir = Math.abs(diff) < 0.005 ? 'eq' : (diff > 0 ? 'up' : 'dn');

				return '<div class="ns-rate"><span>' + esc(r.code) + '</span><b>' + num(r.v, 2) + '</b>' +
					'<i class="hb-' + dir + '">' + (dir == 'up' ? '▲ ' : dir == 'dn' ? '▼ ' : '') +
					(dir == 'eq' ? '—' : num(Math.abs(diff), 2)) + '</i></div>';
			}).join('');
			fxp.hidden = false;
		}

		this.renderSaverNews(false);
	},

	/* headlines as a full-screen wallpaper carousel: the article picture
	   (when the feed has one) under a scrim, the headline set large */
	renderSaverNews(next) {
		const d = this.data.news, wall = this.saver && this.saver.querySelector('.ns-wall');

		if (!wall || !d || !d.items || !d.items.length)
			return;

		if (next)
			this.saverPage = (this.saverPage + 1) % d.items.length;
		else if (wall.querySelector('.ns-slide.on'))
			return;

		this.saverPage %= d.items.length;

		const it = d.items[this.saverPage];
		const slides = wall.querySelectorAll('.ns-slide');
		const cur = wall.querySelector('.ns-slide.on');
		const nxt = (cur === slides[0]) ? slides[1] : slides[0];
		const dots = d.items.map((x, n) => '<i' + (n == this.saverPage ? ' class="on"' : '') + '></i>').join('');

		const show = (img) => {
			nxt.innerHTML =
				(img ? '<img class="ns-img" alt="" referrerpolicy="no-referrer" src="' + esc(img) + '">' : '') +
				'<div class="ns-head">' +
					'<span class="hb-src">' + esc(it.s) + '</span>' +
					'<p>' + esc(it.t) + '</p>' +
					'<span class="ns-dots">' + dots + '</span>' +
				'</div>';
			nxt.classList.toggle('has-img', !!img);
			nxt.classList.add('on');

			if (cur)
				cur.classList.remove('on');
		};

		if (!it.i)
			return show(null);

		/* only swap in a picture that has loaded */
		const probe = new Image();
		probe.referrerPolicy = 'no-referrer';
		probe.onload = () => show(it.i);
		probe.onerror = () => show(null);
		probe.src = it.i;
	},

	city() {
		return ls('city') || defaultCity();
	},

	/* cached in the browser first, router second */
	load(key, fn, force) {
		const c = ls(key);
		const fresh = c && c.data && (Date.now() - c.ts < TTL[key]) &&
			(key != 'wx' || c.city == this.city());

		if (c && c.data && (key != 'wx' || c.city == this.city()))
			this.render(key, c.data);

		if (fresh && !force)
			return;

		Promise.resolve().then(fn).then(res => {
			/* the router fetches in the background: ask again shortly */
			if (res && res.pending) {
				this.tries = this.tries || {};
				this.tries[key] = (this.tries[key] || 0) + 1;

				if (this.tries[key] <= 6)
					window.setTimeout(() => this.load(key, fn, true), 4000);

				return;
			}

			if (!res || res.error)
				return;

			if (this.tries)
				this.tries[key] = 0;

			ls(key, { ts: Date.now(), city: this.city(), data: res });
			this.render(key, res);
		}).catch(() => {});
	},

	render(key, d) {
		this.data[key] = d;

		if (key == 'wx')
			this.renderWeather(d);
		else if (key == 'rates')
			this.renderRates(d);
		else
			this.renderNews(d, true);

		this.box.hidden = !(this.data.wx || this.data.rates || this.data.news);

		if (this.saver && this.saver.isConnected)
			this.renderSaver();
	},

	renderWeather(d) {
		if (this.editing)
			return;

		const kind = wxKind(d.code);
		const ico = (kind == 'clear') ? (d.day === 0 ? 'moon' : 'sun') : kind;
		const t = Math.round(d.t);

		this.el.wx.innerHTML =
			icon(ico) +
			'<b class="hb-temp">' + (t > 0 ? '+' : '') + t + '°</b>' +
			'<button type="button" class="hb-city" title="' + esc(T.city) + '">' + esc(d.city) + '</button>';

		this.el.wx.title = T.wx[kind] + ', ' + T.feels + ' ' + Math.round(d.feels) + '°, ' +
			T.wind + ' ' + num(d.wind, 1) + ' ' + T.ms;
		this.el.wx.hidden = false;

		ROOT.setAttribute('data-wx', (kind == 'drizzle') ? 'rain' : kind);
		ROOT.setAttribute('data-sky', skyOf(d));
	},

	renderRates(d) {
		if (!d.list || !d.list.length)
			return;

		const date = d.date ? new Date(d.date) : null;

		this.el.fx.innerHTML = d.list.map(r => {
			const diff = r.v - r.p;
			const dir = Math.abs(diff) < 0.005 ? 'eq' : (diff > 0 ? 'up' : 'dn');

			return '<span class="hb-cell hb-rate hb-' + esc(r.code.toLowerCase()) + '">' +
				'<span class="hb-code">' + esc(r.code) + '</span>' +
				'<b>' + num(r.v, 2) + '</b>' +
				'<i class="hb-d hb-' + dir + '">' + (dir == 'up' ? '▲' : dir == 'dn' ? '▼' : '•') +
				(dir == 'eq' ? '' : num(Math.abs(diff), 2)) + '</i></span>';
		}).join('');

		this.el.fx.title = date && !isNaN(date) ? T.rates + ' ' + date.toLocaleDateString(RU ? 'ru-RU' : 'en-US') : '';
		this.el.fx.hidden = false;
	},

	renderNews(d, reset) {
		if (!d.items || !d.items.length)
			return;

		if (reset && this.newsIndex >= d.items.length)
			this.newsIndex = 0;

		const it = d.items[this.newsIndex % d.items.length];

		this.el.news.href = it.l;
		this.el.news.title = it.t;
		this.el.news.innerHTML = '<span class="hb-src">' + esc(it.s) + '</span><span class="hb-text">' + esc(it.t) + '</span>';
		this.el.news.hidden = false;
	},

	rotateNews() {
		const d = this.data.news;

		if (!d || !d.items || d.items.length < 2 || this.el.news.matches(':hover'))
			return;

		this.newsIndex = (this.newsIndex + 1) % d.items.length;

		const run = () => this.renderNews(d, false);

		if (ROOT.classList.contains('no-fx')) {
			run();
			return;
		}

		this.el.news.classList.add('hb-out');
		window.setTimeout(() => {
			run();
			this.el.news.classList.remove('hb-out');
		}, 260);
	},

	editCity() {
		if (this.editing)
			return;

		this.editing = true;

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'hb-city-input';
		input.value = this.city();
		input.maxLength = 64;
		input.setAttribute('aria-label', T.city);

		const btn = this.el.wx.querySelector('.hb-city');
		btn.replaceWith(input);
		input.focus();
		input.select();

		const done = (save) => {
			if (!this.editing)
				return;

			this.editing = false;

			const v = input.value.trim();

			if (save && v && v != this.city()) {
				ls('city', v);
				ls('wx', null);
			}

			if (this.data.wx)
				this.renderWeather(this.data.wx);

			if (save)
				this.load('wx', () => callWeather(this.city()), true);
		};

		input.addEventListener('keydown', ev => {
			if (ev.key == 'Enter') done(true);
			else if (ev.key == 'Escape') done(false);
		});
		input.addEventListener('blur', () => done(true));
	}
});
