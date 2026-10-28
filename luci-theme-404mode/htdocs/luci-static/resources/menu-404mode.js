'use strict';
'require baseclass';
'require ui';

/*
 * 404 Mode — cyberpunk theme for LuCI
 * Sidebar / tab menu renderer + HUD helpers
 * https://github.com/dontbass/404-Mode
 * Licensed under the Apache License 2.0.
 */

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

		const syncFx = () => fx.classList.toggle('off', root.classList.contains('no-fx'));

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
		const names = { auto: 'AUTO', dark: 'DARK', light: 'LITE' };
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

	startClock() {
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
