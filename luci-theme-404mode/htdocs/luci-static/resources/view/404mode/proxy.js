'use strict';
'require view';
'require poll';
'require ui';
'require neon-404mode as x';

/*
 * 404 Mode — Proxy: Nikki + mihomo at a glance. Start / stop the service,
 * switch the routing mode, pick a node in any selector group, test delays.
 * Everything goes through the rpcd plugin (ubus 404mode proxy / proxy_set),
 * which talks to the mihomo REST API on the router itself.
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const T = (ru, en) => x.t(ru, en);

const TYPES = {
	Selector: T('выбор вручную', 'manual'),
	URLTest: T('самый быстрый', 'fastest'),
	Fallback: T('первый живой', 'fallback'),
	LoadBalance: T('балансировка', 'load balance'),
	Relay: T('цепочка', 'relay')
};

return view.extend({
	load() {
		x.css();
		return x.proxy();
	},

	render(p) {
		this.root = E('div', { 'class': 'xd xp' }, [
			E('h2', { 'name': 'content' }, [ 'Proxy' ]),
			E('p', { 'class': 'cbi-map-descr' }, [ T('Nikki и ядро mihomo: какой узел сейчас ведёт трафик, режим маршрутизации и группы узлов из подписки.', 'Nikki and the mihomo core: the node carrying traffic now, the routing mode and the node groups from your subscription.') ]),
			E('div', { 'class': 'xp-top' }),
			E('div', { 'class': 'xp-groups' })
		]);

		this.open = {};
		this.paint(p);
		poll.add(() => x.proxy().then(r => this.paint(r)), 5);

		return this.root;
	},

	paint(p) {
		this.p = p;
		const top = this.root.querySelector('.xp-top');
		const groups = this.root.querySelector('.xp-groups');

		top.innerHTML = '';

		if (!p.installed) {
			groups.innerHTML = '';
			top.appendChild(E('section', { 'class': 'xd-card xd-empty' }, [
				E('h3', {}, [ T('Nikki не установлен', 'Nikki is not installed') ]),
				E('p', { 'class': 'xd-muted' }, [ T('Эта страница управляет прокси через Nikki (OpenWrt + mihomo). Установите luci-app-nikki, и она заработает.', 'This page drives the proxy through Nikki (OpenWrt + mihomo). Install luci-app-nikki and it comes alive.') ])
			]));
			return;
		}

		top.appendChild(this.renderService(p));
		top.appendChild(this.renderNow(p));

		if (!p.running || !p.api) {
			groups.innerHTML = '';
			groups.appendChild(E('section', { 'class': 'xd-card xd-empty' }, [
				E('p', { 'class': 'xd-muted' }, [ p.running ? T('mihomo запущен, но его API не отвечает. Проверьте external-controller в профиле.', 'mihomo runs but its API does not answer. Check external-controller in the profile.') : T('Включите прокси, чтобы увидеть группы и узлы.', 'Turn the proxy on to see groups and nodes.') ])
			]));
			return;
		}

		/* keep open groups and scroll position while refreshing */
		const keep = {};
		groups.querySelectorAll('.xp-group').forEach(g => keep[g.getAttribute('data-group')] = g.querySelector('.xp-nodes').scrollTop);
		groups.innerHTML = '';

		(p.groups || []).filter(g => !g.hidden).forEach((g, i) => {
			const card = this.renderGroup(g, p, i);
			groups.appendChild(card);
			if (keep[g.name] != null)
				card.querySelector('.xp-nodes').scrollTop = keep[g.name];
		});
	},

	renderService(p) {
		const sw = x.switchEl(p.running, T('Прокси', 'Proxy'), (on, btn) => {
			btn.disabled = true;
			x.proxySet('service', { on: on }).then(() => {
				ui.addNotification(null, E('p', {}, [ on ? T('Nikki запускается, это займёт несколько секунд.', 'Nikki is starting, it takes a few seconds.') : T('Nikki остановлен.', 'Nikki stopped.') ]), 'info');
				window.setTimeout(() => x.proxy().then(r => this.paint(r)), 3000);
			});
		});

		const mode = (m, label) => E('button', {
			'type': 'button',
			'class': 'xd-seg-btn',
			'aria-pressed': p.mode == m ? 'true' : 'false',
			'disabled': (!p.api) || null,
			'click': () => x.proxySet('mode', { mode: m }).then(() => x.proxy().then(r => this.paint(r)))
		}, [ label ]);

		const tr = p.traffic || {};
		const [ dv, du ] = x.bytes(tr.down), [ uv, uu ] = x.bytes(tr.up);

		return E('section', { 'class': 'xd-card xp-service', 'data-search': 'nikki mihomo служба режим tun прокси включить' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ 'Nikki' ]),
					E('div', { 'class': 'xd-muted' }, [ p.running ? [ 'mihomo', p.core ].filter(Boolean).join(' ') : (p.enabled ? T('включён, но не запущен', 'enabled, not running') : T('выключен', 'off')) ])
				]),
				sw
			]),
			E('div', { 'class': 'xp-mode' }, [
				E('span', { 'class': 'xd-muted' }, [ T('Маршрутизация', 'Routing') ]),
				E('div', { 'class': 'xd-seg' }, [ mode('rule', T('По правилам', 'Rules')), mode('global', T('Весь трафик', 'Global')), mode('direct', T('Напрямую', 'Direct')) ])
			]),
			E('dl', { 'class': 'xp-facts' }, [
				E('div', {}, [ E('dt', {}, [ 'TUN' ]), E('dd', { 'class': p.tun ? 'xd-ok' : 'xd-muted' }, [ p.tun ? T('включён', 'on') + (p.tun_stack ? ', ' + p.tun_stack : '') : T('выключен', 'off') ]) ]),
				E('div', {}, [ E('dt', {}, [ T('Соединений', 'Connections') ]), E('dd', {}, [ p.api ? x.num(tr.conns || 0) : '—' ]) ]),
				E('div', {}, [ E('dt', {}, [ T('Получено', 'Received') ]), E('dd', {}, [ p.api ? dv + ' ' + du : '—' ]) ]),
				E('div', {}, [ E('dt', {}, [ T('Отправлено', 'Sent') ]), E('dd', {}, [ p.api ? uv + ' ' + uu : '—' ]) ])
			]),
			E('div', { 'class': 'xp-links' }, [
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/services/nikki') }, [ T('Настройки Nikki', 'Nikki settings') ])
			])
		]);
	},

	renderNow(p) {
		const node = p.node;
		const test = E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action', 'disabled': (!node || !p.api) || null, 'click': ev => {
			const b = ev.currentTarget;
			b.disabled = true;
			b.textContent = T('Проверяем…', 'Testing…');
			x.proxySet('delay', { name: node.name }).then(r => {
				b.disabled = false;
				b.textContent = T('Проверить пинг', 'Test delay');
				const v = this.root.querySelector('.xp-now-ping');
				v.textContent = x.delayText(r && r.delay);
				v.className = 'xp-now-ping xd-' + x.delayClass(r && r.delay);
			});
		} }, [ T('Проверить пинг', 'Test delay') ]);

		return E('section', { 'class': 'xd-card xd-neon xp-now', 'data-search': 'текущий узел сервер страна пинг' }, [
			E('div', { 'class': 'xd-px-cap' }, [ T('Сейчас трафик идёт через', 'Traffic goes through') ]),
			E('div', { 'class': 'xp-now-node' }, [
				x.flag(node ? node.name : '', 'xf-xl'),
				E('div', { 'class': 'xp-now-txt' }, [
					E('b', {}, [ node ? x.nodeName(node.name) : (p.running ? (p.mode == 'direct' ? T('Напрямую', 'Direct') : '—') : T('Прокси выключен', 'Proxy is off')) ]),
					E('small', {}, [ node ? [ node.type, node.udp ? 'UDP' : null ].filter(Boolean).join(', ') : '' ])
				])
			]),
			E('div', { 'class': 'xp-chain' }, (p.chain || []).map((c, i, a) => E('span', { 'class': i == a.length - 1 ? 'xp-chain-last' : '' }, [ x.nodeName(c) ]))),
			E('div', { 'class': 'xp-now-foot' }, [
				E('span', { 'class': 'xp-now-ping xd-' + x.delayClass(node ? node.delay : null) }, [ x.delayText(node ? node.delay : null) ]),
				test
			])
		]);
	},

	renderGroup(g, p, idx) {
		const selectable = g.type == 'Selector';
		const alive = g.all.filter(n => n.delay > 0).length;

		const testAll = E('button', { 'type': 'button', 'class': 'btn cbi-button xd-btn-s', 'click': ev => {
			const b = ev.currentTarget;
			b.disabled = true;
			b.textContent = T('Проверяем…', 'Testing…');
			x.proxySet('group_delay', { group: g.name }).then(() => x.proxy()).then(r => {
				b.disabled = false;
				this.paint(r);
			});
		} }, [ T('Проверить пинг', 'Test delays') ]);

		const rows = g.all.map(n => {
			const active = g.now == n.name;
			const cls = x.delayClass(n.group ? null : n.delay);
			return E(selectable ? 'button' : 'div', {
				'type': selectable ? 'button' : null,
				'class': 'xp-node' + (active ? ' active' : '') + (selectable ? ' pick' : ''),
				'aria-pressed': selectable ? (active ? 'true' : 'false') : null,
				'title': n.name,
				'click': selectable && !active ? () => {
					x.proxySet('select', { group: g.name, name: n.name }).then(() => x.proxy()).then(r => this.paint(r));
				} : null
			}, [
				E('span', { 'class': 'xp-radio', 'aria-hidden': 'true' }),
				n.group ? x.icon('<path d="M4 7h16M4 12h16M4 17h10"/>', 'xp-gi') : x.flag(n.name, 'xf-s'),
				E('span', { 'class': 'xp-node-txt' }, [
					E('span', {}, [ x.nodeName(n.name) ]),
					E('small', {}, [ n.group ? T('группа', 'group') : (n.type || '') ])
				]),
				E('span', { 'class': 'xp-delay xd-' + cls }, [ n.group ? '' : x.delayText(n.delay) ])
			]);
		});

		return E('section', { 'class': 'xd-card xp-group', 'data-group': g.name, 'data-search': g.name + ' ' + g.all.map(n => n.name).join(' ') }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ x.nodeName(g.name) ]),
					E('div', { 'class': 'xd-muted' }, [ (TYPES[g.type] || g.type) + ', ' + T('узлов: ', 'nodes: ') + g.all.length + (alive ? T(', живых: ', ', alive: ') + alive : '') ])
				]),
				testAll
			]),
			E('div', { 'class': 'xp-nodes' }, rows)
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
