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
			E('div', { 'class': 'xp-manage' }),
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

		const manage = this.root.querySelector('.xp-manage');
		if (!this.busy) {
			manage.innerHTML = '';
			if (p.running && p.api)
				manage.appendChild(this.renderProviders(p));
		}

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
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/services/nikki') }, [ T('Настройки Nikki', 'Nikki settings') ]),
				p.api ? E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action', 'click': ev => this.openDashboard(ev.currentTarget) }, [ T('Панель mihomo', 'mihomo dashboard') ]) : '',
				E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': ev => this.act(ev.currentTarget, 'restart', {}, T('Nikki перезапускается.', 'Nikki is restarting.'), 4000) }, [ T('Перезапустить', 'Restart') ])
			])
		]);
	},

	/* ---------- management ---------- */

	act(btn, action, args, done, wait) {
		const label = btn.textContent;
		btn.disabled = true;
		btn.classList.add('busy');
		this.busy = true;
		return x.proxySet(action, args || {}).then(r => {
			if (r && r.error)
				ui.addNotification(null, E('p', {}, [ T('Не получилось: ', 'Failed: ') + r.error ]), 'danger');
			else if (done)
				ui.addNotification(null, E('p', {}, [ done ]), 'info');
		}).catch(e => {
			ui.addNotification(null, E('p', {}, [ String(e) ]), 'danger');
		}).then(() => new Promise(res => window.setTimeout(res, wait || 600))).then(() => {
			btn.disabled = false;
			btn.classList.remove('busy');
			btn.textContent = label;
			this.busy = false;
			return x.proxy().then(r => this.paint(r));
		});
	},

	openDashboard(btn) {
		/* open the tab synchronously, fill the address once the router answers */
		const w = window.open('', '_blank');
		x.proxySet('dashboard').then(d => {
			const host = location.hostname;
			const q = new URLSearchParams({ hostname: host, host: host, port: d.port, secret: d.secret || '' }).toString();
			const url = (d.tls ? 'https' : 'http') + '://' + host + ':' + d.port + '/ui/' + (d.ui ? d.ui + '/' : '') + '?' + q;
			if (w) w.location = url; else location.href = url;
		}).catch(() => { if (w) w.close(); });
	},

	ago(t) {
		const ms = Date.parse(t || '');
		if (!ms || ms < 946684800000)
			return T('ещё не обновлялся', 'never updated');
		const s = Math.max(0, (Date.now() - ms) / 1000);
		if (s < 90) return T('обновлён только что', 'updated just now');
		if (s < 3600) return T('обновлён ' + Math.round(s / 60) + ' мин назад', 'updated ' + Math.round(s / 60) + ' min ago');
		if (s < 86400) return T('обновлён ' + Math.round(s / 3600) + ' ч назад', 'updated ' + Math.round(s / 3600) + ' h ago');
		return T('обновлён ' + Math.round(s / 86400) + ' д назад', 'updated ' + Math.round(s / 86400) + ' d ago');
	},

	renderProviders(p) {
		const btn = (label, cls, fn, title) => E('button', { 'type': 'button', 'class': 'btn cbi-button xd-btn-s ' + (cls || ''), 'title': title || null, 'click': ev => fn(ev.currentTarget) }, [ label ]);
		const provs = p.providers || [], rules = p.rules || [];

		const rows = provs.map(v => {
			const sub = v.sub || {};
			const used = (+sub.Upload || 0) + (+sub.Download || 0), total = +sub.Total || 0;
			const [ uv, uu ] = x.bytes(used), [ tv, tu ] = x.bytes(total);
			const exp = +sub.Expire ? new Date(sub.Expire * 1000).toLocaleDateString(x.RU ? 'ru-RU' : 'en-GB') : null;

			return E('div', { 'class': 'xp-prov' }, [
				E('div', { 'class': 'xp-prov-main' }, [
					E('b', {}, [ v.name ]),
					E('small', { 'class': 'xd-muted' }, [ [ T('узлов: ', 'nodes: ') + v.count + (v.alive ? T(', живых: ', ', alive: ') + v.alive : ''), v.vehicle, this.ago(v.updated) ].filter(Boolean).join(', ') ]),
					total ? E('div', { 'class': 'xp-prov-quota' }, [
						E('div', { 'class': 'xd-track' }, [ E('i', { 'style': 'width:' + Math.min(100, used / total * 100).toFixed(1) + '%', 'class': used / total > .9 ? 'warn' : '' }) ]),
						E('small', { 'class': 'xd-muted' }, [ uv + ' ' + uu + T(' из ', ' of ') + tv + ' ' + tu + (exp ? T(', до ', ', until ') + exp : '') ])
					]) : ''
				]),
				E('div', { 'class': 'xp-prov-act' }, [
					btn(T('Обновить', 'Update'), 'cbi-button-action', b => this.act(b, 'provider_update', { name: v.name }, T('Провайдер «', 'Provider “') + v.name + T('» обновлён.', '” updated.'))),
					btn(T('Пинг', 'Test'), '', b => this.act(b, 'provider_check', { name: v.name }, null, 1500), T('Проверить все узлы провайдера', 'Health-check every node'))
				])
			]);
		});

		return E('section', { 'class': 'xd-card xp-providers', 'data-search': 'провайдеры подписка обновить правила rule provider subscription dns fake-ip соединения' }, [
			E('div', { 'class': 'xd-card-head' }, [
				E('div', {}, [
					E('h3', {}, [ T('Подписки и провайдеры', 'Subscriptions and providers') ]),
					E('div', { 'class': 'xd-muted' }, [ T('Прокси-провайдеров: ', 'Proxy providers: ') + provs.length + T(', наборов правил: ', ', rule sets: ') + rules.length ])
				]),
				E('div', { 'class': 'xp-head-act' }, [
					btn(T('Обновить подписки Nikki', 'Update Nikki subscriptions'), 'cbi-button-action', b => this.act(b, 'subscription', {}, T('Подписки обновляются, профиль перезагрузится.', 'Subscriptions are updating, the profile will reload.'), 3000)),
					provs.length ? btn(T('Обновить всех провайдеров', 'Update all providers'), '', b => {
						b.disabled = true;
						Promise.all(provs.map(v => x.proxySet('provider_update', { name: v.name }))).then(() => this.act(b, 'flush_fakeip', {}, T('Провайдеры обновлены.', 'Providers updated.')));
					}) : ''
				])
			]),
			provs.length ? E('div', { 'class': 'xp-provs' }, rows) : E('p', { 'class': 'xd-muted' }, [ T('В профиле нет proxy-providers: узлы прописаны прямо в конфигурации.', 'The profile has no proxy-providers: nodes are defined inline.') ]),
			rules.length ? E('div', { 'class': 'xp-rules' }, [
				E('div', { 'class': 'xp-rules-head' }, [
					E('span', { 'class': 'xd-muted' }, [ T('Наборы правил', 'Rule sets') ]),
					btn(T('Обновить все', 'Update all'), '', b => {
						b.disabled = true;
						Promise.all(rules.map(r => x.proxySet('rules_update', { name: r.name }))).then(() => this.act(b, 'flush_fakeip', {}, T('Наборы правил обновлены.', 'Rule sets updated.')));
					})
				]),
				E('div', { 'class': 'xp-rule-list' }, rules.map(r => E('button', {
					'type': 'button',
					'class': 'xp-rule',
					'title': [ r.behavior, r.vehicle, this.ago(r.updated) ].filter(Boolean).join(', ') + T('. Нажмите, чтобы обновить.', '. Click to update.'),
					'click': ev => this.act(ev.currentTarget, 'rules_update', { name: r.name }, T('Набор «', 'Rule set “') + r.name + T('» обновлён.', '” updated.'))
				}, [ E('span', {}, [ r.name ]), E('small', {}, [ x.num(r.count || 0) ]) ])))
			]) : '',
			E('div', { 'class': 'xp-tools' }, [
				btn(T('Закрыть все соединения', 'Close all connections'), 'cbi-button-negative', b => this.act(b, 'close_conns', {}, T('Соединения закрыты.', 'Connections closed.'))),
				btn(T('Очистить кэш fake-ip', 'Flush fake-ip cache'), '', b => this.act(b, 'flush_fakeip', {}, T('Кэш fake-ip очищен.', 'Fake-ip cache flushed.')))
			])
		]);
	},

	renderNow(p) {
		const node = p.node || (p.running && p.chain && p.chain.length > 1 ? { name: p.chain[p.chain.length - 1], delay: null } : null);
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

	/* one card per group, nodes as tiles — the way mihomo dashboards lay
	   them out: name with flag, protocol / udp, last delay */
	renderGroup(g, p, idx) {
		const selectable = g.type == 'Selector';
		const leaves = g.all.filter(n => !n.group);
		const alive = g.all.filter(n => n.delay > 0).length;

		const testAll = E('button', { 'type': 'button', 'class': 'btn cbi-button xd-btn-s xp-test', 'title': T('Проверить пинг всех узлов группы', 'Test every node of the group'), 'click': ev => {
			const b = ev.currentTarget;
			b.disabled = true;
			b.classList.add('busy');
			x.proxySet('group_delay', { group: g.name }).then(() => x.proxy()).then(r => {
				b.disabled = false;
				b.classList.remove('busy');
				this.paint(r);
			});
		} }, [ x.icon('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'), E('span', {}, [ T('Пинг', 'Test') ]) ]);

		const tiles = g.all.map(n => {
			const active = g.now == n.name;
			const proto = n.group ? String(n.type || '').toLowerCase() : String(n.type || '').toLowerCase();
			const meta = [ proto, n.xudp ? 'xudp' : (n.udp ? 'udp' : null) ].filter(Boolean).join(' / ');

			const delay = E('span', {
				'class': 'xp-tile-delay xd-' + x.delayClass(n.delay),
				'title': n.group ? '' : T('Проверить этот узел', 'Test this node'),
				'click': n.group ? null : ev => {
					ev.stopPropagation();
					const el = ev.currentTarget;
					el.textContent = '…';
					x.proxySet('delay', { name: n.name }).then(r => {
						const d = r && r.delay;
						el.textContent = d ? d : x.t('нет', 'n/a');
						el.className = 'xp-tile-delay xd-' + x.delayClass(d);
					});
				}
			}, [ n.delay ? String(n.delay) : (n.delay === 0 ? T('нет', 'n/a') : (n.group ? '' : '⚡')) ]);

			return E(selectable ? 'button' : 'div', {
				'type': selectable ? 'button' : null,
				'class': 'xp-tile' + (active ? ' active' : '') + (selectable ? ' pick' : ''),
				'aria-pressed': selectable ? (active ? 'true' : 'false') : null,
				'title': n.name,
				'click': selectable && !active ? () => {
					x.proxySet('select', { group: g.name, name: n.name }).then(() => x.proxy()).then(r => this.paint(r));
				} : null
			}, [
				E('span', { 'class': 'xp-tile-name' }, [
					n.group ? x.icon('<path d="M4 7h16M4 12h16M4 17h10"/>', 'xp-gi') : x.flag(n.name, 'xf-s'),
					E('span', {}, [ x.nodeName(n.name) ])
				]),
				E('span', { 'class': 'xp-tile-meta' }, [ E('small', {}, [ meta ]), delay ])
			]);
		});

		const now = g.now ? g.all.find(n => n.name == g.now) : null;

		return E('section', { 'class': 'xd-card xp-group', 'data-group': g.name, 'data-search': g.name + ' ' + g.all.map(n => n.name).join(' ') }, [
			E('div', { 'class': 'xp-ghead' }, [
				E('div', { 'class': 'xp-gtitle' }, [
					E('h3', {}, [ x.nodeName(g.name) ]),
					E('span', { 'class': 'xp-gtype' }, [ g.type ]),
					E('span', { 'class': 'xp-gcount' }, [ (leaves.length ? alive + '/' : '') + g.all.length ]),
					g.delay ? E('span', { 'class': 'xp-gdelay xd-' + x.delayClass(g.delay) }, [ g.delay + ' ' + T('мс', 'ms') ]) : ''
				]),
				testAll
			]),
			g.now ? E('div', { 'class': 'xp-gnow' }, [
				E('span', { 'class': 'xd-muted' }, [ (TYPES[g.type] || g.type) + ' › ' ]),
				now && !now.group ? x.flag(now.name, 'xf-s') : '',
				E('b', {}, [ x.nodeName(g.now) ])
			]) : '',
			E('div', { 'class': 'xp-nodes' }, tiles)
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
