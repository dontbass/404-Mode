'use strict';
'require baseclass';
'require ui';
'require rpc';

/*
 * 404 Mode — cyberpunk theme for LuCI
 * Sidebar / tab menu renderer + HUD helpers
 * https://github.com/dontbass/404-Mode
 * Licensed under the Apache License 2.0.
 */

const callRcList = rpc.declare({ object: 'rc', method: 'list', params: [ 'name' ], expect: { '': {} } });

/* stroke icons for the neon sidebar, 24×24 */
const ICONS = {
	dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
	quickstart: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
	status: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
	system: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
	services: '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-.6-.6-2.4z"/>',
	network: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 3.2-3 14.8 0 18M12 3c3 3.2 3 14.8 0 18"/>',
	modem: '<path d="M12 13v8M8 21h8"/><circle cx="12" cy="10" r="2"/><path d="M7.8 5.8a6 6 0 0 0 0 8.4M16.2 5.8a6 6 0 0 1 0 8.4M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14"/>',
	proxy: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
	vpn: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
	nas: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
	firewall: '<path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.1 7.5 10 4.3-1.9 7.5-5.4 7.5-10v-6z"/>',
	statistics: '<path d="M3 21h18M6 17v-5M10.5 17V7M15 17v-7M19.5 17V4"/>',
	docker: '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
	store: '<path d="M4 8h16l-1.2 11.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>',
	control: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
	logout: '<path d="M9 4H5v16h4M15 8l4 4-4 4M19 12H9"/>',
	other: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6M12 9v6"/>'
};

const ICON_ALIAS = { overview: 'dashboard', istore: 'store', iStore: 'store', app: 'store', mwan3: 'network', qmodem: 'modem', modem_ctrl: 'modem', nikki: 'proxy', services_proxy: 'proxy', usb: 'nas', storage: 'nas' };

function icon(name) {
	const path = ICONS[name] || ICONS[ICON_ALIAS[name]] || ICONS.other;
	const span = E('span', { 'class': 'nav-icon', 'aria-hidden': 'true' });
	span.innerHTML = '<svg viewBox="0 0 24 24">' + path + '</svg>';
	return span;
}

/* words people type that are not in the menu titles */
const SYNONYMS = {
	wireless: 'wifi wi-fi вайфай вай-фай беспроводн точка доступа ssid',
	network: 'сеть интерфейсы lan wan ip',
	firewall: 'межсетевой экран порты проброс nat фаервол',
	dhcp: 'dhcp dns адреса аренда',
	system: 'система имя хоста время часовой пояс',
	admin: 'пароль password ssh dropbear доступ',
	startup: 'автозапуск init службы',
	crontab: 'cron крон планировщик задачи',
	flash: 'прошивка обновление резервная копия backup sysupgrade',
	reboot: 'перезагрузка reboot',
	syslog: 'лог журнал logread',
	logs: 'лог журнал logread',
	realtime: 'график нагрузка трафик',
	modem: 'модем сим sim imei band бэнд lte 5g ttl сигнал',
	qmodem: 'модем сим sim imei band бэнд lte 5g ttl сигнал',
	ttl: 'ttl hop limit раздача',
	sms: 'смс sms ussd сообщения',
	proxy: 'proxy прокси nikki mihomo clash vpn туннель узлы tun',
	nikki: 'proxy прокси nikki mihomo clash vpn туннель узлы tun',
	dashboard: 'обзор главная dashboard',
	mounts: 'диск монтирование хранилище emmc nvme usb',
	nas: 'диск хранилище samba nas',
	'3x-ui': '3x-ui xray xui',
	xray: '3x-ui xray xui vless'
};

function norm(s) {
	return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function hex(n) {
	return '0x' + ('0' + n.toString(16).toUpperCase()).slice(-2);
}

function store(key, value) {
	try {
		if (value === undefined)
			return localStorage.getItem(key);
		if (value === null)
			localStorage.removeItem(key);
		else
			localStorage.setItem(key, value);
	}
	catch (e) {}

	return null;
}

return baseclass.extend({
	__init__() {
		ui.menu.load().then(L.bind(this.render, this));
	},

	render(tree) {
		let node = tree;
		let url = '';

		this.renderModeMenu(tree);

		if (L.env.dispatchpath.length >= 3) {
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}

		this.bindHud();
		this.bindSearch(tree);
		this.proxyDot();

		window.__404menuReady = true;
		document.dispatchEvent(new CustomEvent('404mode-menu'));
	},

	/* ---------- mode menu (admin / other top-level trees) ---------- */

	renderModeMenu(tree) {
		const ul = document.querySelector('#modemenu');
		const children = ui.menu.getChildren(tree);

		children.forEach((child, index) => {
			const isActive = L.env.requestpath.length
				? child.name === L.env.requestpath[0]
				: index === 0;

			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				this.renderMainMenu(child, child.name);
		});

		if (children.length > 1)
			ul.style.display = '';
	},

	/* ---------- sidebar ---------- */

	renderMainMenu(tree, url) {
		const container = document.querySelector('#mainmenu');
		const ul = E('ul', { 'class': 'nav' });
		const categories = ui.menu.getChildren(tree);

		categories.forEach((cat, index) => {
			const catUrl = url + '/' + cat.name;
			const items = ui.menu.getChildren(cat);
			const isActive = (L.env.dispatchpath[1] == cat.name);
			const title = _(cat.title);

			/* leaf at top level (e.g. Logout) */
			if (!items.length) {
				ul.appendChild(E('li', {
					'class': 'nav-leaf nav-leaf-%s%s'.format(cat.name, isActive ? ' active' : '')
				}, [
					E('a', { 'href': L.url(catUrl), 'title': title }, [
						E('span', { 'class': 'nav-index' }, [ hex(index + 1) ]),
						icon(cat.name),
						E('span', { 'class': 'nav-title' }, [ title ])
					])
				]));
				return;
			}

			const sub = E('ul', { 'class': 'nav-sub' });

			items.forEach(item => {
				const itemActive = isActive && (L.env.dispatchpath[2] == item.name);

				sub.appendChild(E('li', { 'class': itemActive ? 'active' : '' }, [
					E('a', { 'href': L.url(catUrl, item.name) }, [ _(item.title) ])
				]));
			});

			const li = E('li', {
				'class': 'nav-cat nav-cat-%s%s'.format(cat.name, isActive ? ' open active' : '')
			}, [
				E('button', {
					'type': 'button',
					'class': 'nav-head',
					'title': title,
					'aria-expanded': isActive ? 'true' : 'false',
					'click': ev => this.handleCategoryToggle(ev, li)
				}, [
					E('span', { 'class': 'nav-index' }, [ hex(index + 1) ]),
					icon(cat.name),
					E('span', { 'class': 'nav-title' }, [ title ]),
					E('span', { 'class': 'nav-chevron', 'aria-hidden': 'true' })
				]),
				sub
			]);

			ul.appendChild(li);
		});

		container.appendChild(ul);
		container.style.display = '';

		return ul;
	},

	handleCategoryToggle(ev, li) {
		const root = document.documentElement;

		/* in mini mode a click expands the sidebar instead */
		if (root.classList.contains('nav-mini') && window.innerWidth > 854) {
			root.classList.remove('nav-mini');
			store('404mode.nav', null);
		}

		const open = !li.classList.contains('open');

		document.querySelectorAll('#mainmenu .nav-cat.open').forEach(other => {
			if (other !== li) {
				other.classList.remove('open');
				other.querySelector('.nav-head').setAttribute('aria-expanded', 'false');
			}
		});

		li.classList.toggle('open', open);
		ev.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
	},

	/* ---------- page tabs ---------- */

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const l = (level || 0) + 1;
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		if (children.length == 0)
			return E([]);

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[l + 2] == child.name);

			ul.appendChild(E('li', {
				'class': 'tabmenu-item-%s%s'.format(child.name, isActive ? ' active' : '')
			}, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				activeNode = child;
		});

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, l);

		return ul;
	},

	/* ---------- HUD: drawer, mini mode, FX, clock ---------- */

	bindHud() {
		const root = document.documentElement;
		const toggle = document.querySelector('#nav-toggle');
		const mask = document.querySelector('#nav-mask');
		const collapse = document.querySelector('#nav-collapse');
		const fx = document.querySelector('#fx-toggle');

		const setDrawer = open => {
			root.classList.toggle('nav-open', open);
			toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
		};

		toggle.addEventListener('click', () => setDrawer(!root.classList.contains('nav-open')));
		mask.addEventListener('click', () => setDrawer(false));
		document.addEventListener('keydown', ev => {
			if (ev.key === 'Escape' && root.classList.contains('nav-open'))
				setDrawer(false);
		});

		collapse.addEventListener('click', () => {
			const mini = !root.classList.contains('nav-mini');
			root.classList.toggle('nav-mini', mini);
			store('404mode.nav', mini ? 'mini' : null);
		});

		const syncFx = () => {
			fx.classList.toggle('off', root.classList.contains('no-fx'));
			if (window.__404scheme && window.__404scheme.broadcast)
				window.__404scheme.broadcast();
		};

		fx.addEventListener('click', () => {
			const off = !root.classList.contains('no-fx');
			root.classList.toggle('no-fx', off);
			store('404mode.fx', off ? 'off' : null);
			syncFx();
		});

		syncFx();
		this.bindScheme();
		this.startClock();
	},

	bindScheme() {
		const btn = document.querySelector('#scheme-toggle');
		const api = window.__404scheme;

		if (!btn || !api || api.locked)
			return;

		const order = [ 'auto', 'dark', 'light' ];
		const neon = document.documentElement.getAttribute('data-skin') == 'neon';
		const ru = (document.documentElement.lang || '').slice(0, 2) == 'ru';
		const names = !neon ? { auto: 'AUTO', dark: 'DARK', light: 'LITE' }
			: ru ? { auto: 'Авто', dark: 'Тёмная', light: 'Светлая' } : { auto: 'Auto', dark: 'Dark', light: 'Light' };
		const label = btn.querySelector('.hud-scheme-label');

		const sync = () => {
			const cur = api.get();
			label.textContent = names[cur] || 'AUTO';
			btn.setAttribute('data-scheme', cur);
		};

		btn.addEventListener('click', () => {
			const cur = api.get();
			api.set(order[(order.indexOf(cur) + 1) % order.length]);
			sync();
		});

		sync();
	},

	/* ---------- settings search (neon header) ---------- */

	/* every reachable page: sidebar categories, their items and the tabs below */
	buildIndex(tree) {
		const out = [];
		const admin = tree && tree.children && tree.children.admin;

		const walk = (node, path, titles, depth) => {
			ui.menu.getChildren(node).forEach(child => {
				const p = path.concat(child.name);
				const t = titles.concat(_(child.title));
				const kids = ui.menu.getChildren(child);

				out.push({
					title: _(child.title),
					trail: titles.join(' › '),
					url: L.url.apply(L, [ 'admin' ].concat(p)),
					keys: norm(t.join(' ') + ' ' + p.join(' ') + ' ' + p.map(n => SYNONYMS[n] || '').join(' ')),
					group: !!kids.length && depth == 0,
					navName: depth == 0 ? child.name : null,
					navPath: p
				});

				if (depth < 2)
					walk(child, p, t, depth + 1);
			});
		};

		if (admin)
			walk(admin, [], [], 0);

		return out;
	},

	/* things on the current page a query can point at */
	pageTargets() {
		const view = document.querySelector('#view');
		const out = [];

		if (!view)
			return out;

		view.querySelectorAll('[data-search]').forEach(el => {
			const head = el.querySelector('h3, h2, legend');
			out.push({ el: el, title: (head ? head.textContent : el.getAttribute('aria-label') || '').trim(), keys: norm(el.getAttribute('data-search') + ' ' + el.textContent) });
		});

		view.querySelectorAll('.cbi-section > h3, .cbi-section > legend, fieldset > legend, .cbi-value-title, .cbi-tabmenu > li > a, .cbi-section-table-titles .th').forEach(el => {
			const text = el.textContent.trim();
			if (!text)
				return;
			const host = el.closest('.cbi-value') || el.closest('li') || el.closest('.cbi-section') || el;
			out.push({ el: host, title: text, keys: norm(text), tab: el.closest('.cbi-tabmenu') ? el : null });
		});

		return out;
	},

	bindSearch(tree) {
		const input = document.querySelector('#hud-search');
		const box = document.querySelector('#hud-search-results');

		if (!input || !box)
			return;

		const index = this.buildIndex(tree);

		if (window.innerWidth < 600)
			input.placeholder = (document.documentElement.lang || '').slice(0, 2) == 'ru' ? 'Поиск настроек' : 'Search settings';
		const word = ru => (document.documentElement.lang || '').slice(0, 2) == 'ru' ? ru[0] : ru[1];
		let hits = [], sel = 0, timer = null;

		const clear = () => {
			document.querySelectorAll('.n-hit').forEach(el => el.classList.remove('n-hit'));
		};

		const mark = (text, q) => {
			const i = norm(text).indexOf(q);
			if (i < 0 || !q)
				return document.createTextNode(text);
			return E('span', {}, [ text.slice(0, i), E('mark', {}, [ text.slice(i, i + q.length) ]), text.slice(i + q.length) ]);
		};

		const close = () => {
			box.hidden = true;
			input.setAttribute('aria-expanded', 'false');
		};

		const go = hit => {
			close();

			if (hit.el) {
				if (hit.tab)
					hit.tab.click();
				hit.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				hit.el.classList.remove('n-flash');
				void hit.el.offsetWidth;
				hit.el.classList.add('n-flash');
				input.blur();
			}
			else {
				location.href = hit.url;
			}
		};

		const paint = () => {
			box.querySelectorAll('.hs-item').forEach((b, i) => b.setAttribute('aria-selected', i == sel ? 'true' : 'false'));
		};

		const run = () => {
			const q = norm(input.value);

			clear();

			if (q.length < 2) {
				close();
				return;
			}

			const page = this.pageTargets().filter(t => t.keys.indexOf(q) > -1);
			const pages = index.filter(e => e.keys.indexOf(q) > -1)
				.sort((a, b) => (norm(b.title).indexOf(q) == 0) - (norm(a.title).indexOf(q) == 0));

			/* light up what matches: cards and fields here, sections in the menu */
			page.forEach(t => t.el.classList.add('n-hit'));
			pages.forEach(e => {
				const link = document.querySelector('#mainmenu a[href="' + e.url + '"]');
				const cat = e.navName && document.querySelector('#mainmenu .nav-cat-' + e.navName + ' > .nav-head');
				(cat || link) && (cat || link).classList.add('n-hit');
			});

			hits = page.slice(0, 6).map(t => ({ title: t.title, trail: word([ 'на этой странице', 'on this page' ]), el: t.el, tab: t.tab, here: true }))
				.concat(pages.filter(e => !e.group || pages.length < 4).slice(0, 10));
			sel = 0;

			box.innerHTML = '';

			if (!hits.length) {
				box.appendChild(E('div', { 'class': 'hs-empty' }, [ word([ 'Ничего не нашлось. Попробуйте «Wi-Fi», «DNS» или «пароль».', 'Nothing found. Try “Wi-Fi”, “DNS” or “password”.' ]) ]));
			}
			else {
				hits.forEach((h, i) => {
					box.appendChild(E('button', {
						'type': 'button',
						'class': 'hs-item',
						'role': 'option',
						'aria-selected': i == 0 ? 'true' : 'false',
						'mousedown': ev => ev.preventDefault(),
						'click': () => go(h)
					}, [
						E('span', { 'class': 'hs-title' }, [ mark(h.title, q) ]),
						E('span', { 'class': h.here ? 'hs-here' : 'hs-path' }, [ h.trail || '' ])
					]));
				});
			}

			box.hidden = false;
			input.setAttribute('aria-expanded', 'true');
		};

		input.addEventListener('input', () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(run, 80);
		});

		input.addEventListener('focus', () => { if (norm(input.value).length >= 2) run(); });
		input.addEventListener('blur', () => window.setTimeout(close, 120));

		input.addEventListener('keydown', ev => {
			if (ev.key == 'ArrowDown' || ev.key == 'ArrowUp') {
				if (!hits.length) return;
				ev.preventDefault();
				sel = (sel + (ev.key == 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
				paint();
			}
			else if (ev.key == 'Enter') {
				ev.preventDefault();
				if (hits[sel]) go(hits[sel]);
			}
			else if (ev.key == 'Escape') {
				input.value = '';
				clear();
				close();
				input.blur();
			}
		});

		document.addEventListener('keydown', ev => {
			const t = ev.target;
			if (ev.key == '/' && !ev.ctrlKey && !ev.metaKey && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) {
				ev.preventDefault();
				input.focus();
				input.select();
			}
		});
	},

	/* green dot next to "Proxy" while Nikki runs */
	proxyDot() {
		const leaf = document.querySelector('#mainmenu .nav-leaf-proxy > a');

		if (!leaf || document.documentElement.getAttribute('data-skin') != 'neon')
			return;

		L.resolveDefault(callRcList('nikki'), {}).then(res => {
			const svc = res && res.nikki;
			if (!svc)
				return;
			leaf.appendChild(E('span', { 'class': 'nav-dot' + (svc.running ? ' on' : ''), 'title': svc.running ? 'Nikki' : '' }));
		});
	},

	startClock() {
		const up = document.querySelector('#side-uptime');

		if (up) {
			const t0 = Date.now(), base = +up.getAttribute('data-uptime') || 0;
			const ru = (document.documentElement.lang || '').slice(0, 2) == 'ru';
			const fmt = t => {
				const d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60);
				return ru ? (d ? d + ' д ' + h + ' ч' : h + ' ч ' + m + ' мин') : (d ? d + 'd ' + h + 'h' : h + 'h ' + m + 'm');
			};
			window.setInterval(() => { up.textContent = fmt(base + Math.floor((Date.now() - t0) / 1000)); }, 60000);
		}

		const el = document.querySelector('#hud-clock');

		if (!el)
			return;

		const pad = n => (n < 10 ? '0' : '') + n;
		const tick = () => {
			const d = new Date();
			el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
		};

		tick();
		window.setInterval(tick, 1000);
	}
});
