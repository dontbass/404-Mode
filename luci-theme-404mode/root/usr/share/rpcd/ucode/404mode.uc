/*
 * 404 Mode — header brief: weather, exchange rates, headlines.
 *
 * ubus object "404mode" (rpcd ucode plugin):
 *   weather { city }  current weather for a city      (Open-Meteo, no key)
 *   rates             USD / EUR / CNY to RUB           (CBR daily, cbr-xml-daily.ru)
 *   news              latest headlines                 (OpenNet, Habr RSS)
 *   proxy             Nikki / mihomo state: service, mode, groups, nodes,
 *                     the node in use, traffic totals    (mihomo REST API)
 *   proxy_set { action, group, name, mode, on }
 *                     select a node, test delays, switch the mode, start /
 *                     stop Nikki
 *
 * Calls never wait for the network: they answer from the cache in /tmp and,
 * when it is old or missing, start /usr/libexec/404mode-brief in the
 * background to refresh it ({ pending: true } until the first answer).
 * The browser needs no access to the sources, and every device shares the
 * same cache.
 *
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

'use strict';

import { readfile, writefile, stat, popen, access } from 'fs';

const DIR = '/tmp/404mode-brief';
const BIN = '/usr/libexec/404mode-brief';

function shellquote(s) {
	return "'" + replace(s, "'", "'\\''") + "'";
}

function urlencode(s) {
	let out = '';

	for (let i = 0; i < length(s); i++) {
		const c = ord(s, i);

		if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 45 || c == 46 || c == 95 || c == 126)
			out += chr(c);
		else
			out += sprintf('%%%02X', c);
	}

	return out;
}

function answer(key, ttl, cmd) {
	const file = DIR + '/' + key + '.json';
	const st = stat(file);
	const lock = stat(DIR + '/' + key + '.lock');
	let res = null;

	if ((!st || time() - st.mtime >= ttl) && !(lock && time() - lock.mtime < 180))
		system(BIN + ' ' + cmd + ' >/dev/null 2>&1 </dev/null &');

	if (st)
		try { res = json(readfile(file)); } catch (e) { res = null; }

	if (res && time() - st.mtime >= ttl)
		res.stale = true;

	return res ?? { pending: true };
}

/* ---------- Nikki / mihomo ---------- */

const NIKKI_INIT = '/etc/init.d/nikki';
const NIKKI_RUN = '/etc/nikki/run/config.yaml';
const API_CACHE = '/tmp/404mode-mihomo.json';
const DELAY_URL = 'https://www.gstatic.com/generate_204';

function sh(cmd) {
	const p = popen(cmd, 'r');
	if (!p)
		return '';
	const out = p.read('all');
	p.close();
	return out ?? '';
}

function uci_get(path) {
	return trim(sh('uci -q get ' + shellquote(path) + ' 2>/dev/null'));
}

/* where the controller listens and its secret, re-read when the running
   profile changes */
function controller() {
	const st = stat(NIKKI_RUN);

	if (!st)
		return null;

	let c = null;
	try { c = json(readfile(API_CACHE)); } catch (e) { c = null; }

	if (!c || c.mtime != st.mtime) {
		let raw = null;
		try {
			raw = json(sh("yq -M -p yaml -o json '{\"api\": .\"external-controller\", \"tls\": .\"external-controller-tls\", \"secret\": .secret}' " + NIKKI_RUN + ' 2>/dev/null'));
		} catch (e) { raw = null; }

		if (!raw)
			return null;

		const listen = raw.tls ?? raw.api;
		if (!listen)
			return null;

		const port = match(listen, /:(\d+)$/);
		c = {
			mtime: st.mtime,
			base: (raw.tls ? 'https' : 'http') + '://127.0.0.1:' + (port ? port[1] : '9090'),
			secret: raw.secret ?? ''
		};
		writefile(API_CACHE, sprintf('%J', c));
	}

	return c;
}

function curl(c, method, path, body) {
	let cmd = 'curl -s -k -m 6 --connect-timeout 2 -X ' + method +
		' -H ' + shellquote('Authorization: Bearer ' + c.secret);

	if (body != null)
		cmd += ' -H "Content-Type: application/json" --data ' + shellquote(sprintf('%J', body));

	return cmd + ' ' + shellquote(c.base + path);
}

function api(c, method, path, body) {
	const out = trim(sh(curl(c, method, path, body) + ' 2>/dev/null'));

	if (!length(out))
		return {};

	try { return json(out); } catch (e) { return { error: substr(out, 0, 200) }; }
}

function last_delay(p) {
	const h = p?.history;
	return (type(h) == 'array' && length(h)) ? (h[-1].delay ?? 0) : null;
}

const GROUPS = { Selector: true, URLTest: true, Fallback: true, LoadBalance: true, Relay: true };

function nikki_state() {
	const res = {
		installed: !!access(NIKKI_INIT, 'x'),
		enabled: uci_get('nikki.config.enabled') == '1',
		running: false,
		api: false
	};

	if (!res.installed)
		return res;

	res.running = length(trim(sh('pidof mihomo 2>/dev/null'))) > 0;
	res.profile = uci_get('nikki.config.profile');

	const c = res.running ? controller() : null;
	if (!c)
		return res;

	const ver = api(c, 'GET', '/version');
	if (!ver?.version)
		return res;

	res.api = true;
	res.core = ver.version;

	const cfg = api(c, 'GET', '/configs');
	res.mode = cfg?.mode;
	res.tun = !!cfg?.tun?.enable;
	res.tun_stack = cfg?.tun?.stack;

	const all = api(c, 'GET', '/proxies')?.proxies ?? {};
	const order = all.GLOBAL?.all ?? [];
	const groups = [];
	const seen = {};

	const add = (name) => {
		const g = all[name];
		if (!g || !GROUPS[g.type] || seen[name])
			return;
		seen[name] = true;
		push(groups, {
			name: name,
			type: g.type,
			now: g.now,
			hidden: !!g.hidden,
			icon: g.icon,
			all: map(g.all ?? [], (n) => ({
				name: n,
				type: all[n]?.type,
				udp: !!all[n]?.udp,
				group: !!GROUPS[all[n]?.type],
				delay: last_delay(all[n])
			}))
		});
	};

	for (let n in order)
		add(n);
	for (let n in keys(all))
		if (n != 'GLOBAL')
			add(n);

	res.groups = groups;

	/* the main group: the first selector the user can switch */
	let main = null;
	for (let g in groups)
		if (g.type == 'Selector' && !g.hidden) { main = g.name; break; }
	if (!main)
		main = groups[0]?.name;
	res.main = main;

	/* follow "now" down to the node actually carrying traffic */
	const chain = [];
	let cur = main;
	while (cur && length(chain) < 8) {
		push(chain, cur);
		const p = all[cur];
		if (!p || !GROUPS[p.type] || !p.now)
			break;
		cur = p.now;
	}
	res.chain = chain;

	const leaf = all[chain[-1]];
	if (leaf && !GROUPS[leaf.type])
		res.node = { name: chain[-1], type: leaf.type, udp: !!leaf.udp, delay: last_delay(leaf) };

	/* traffic totals and the number of open connections, streamed through awk
	   so the router never parses the whole connection list */
	const t = split(trim(sh(curl(c, 'GET', '/connections') +
		" 2>/dev/null | tr ',' '\\n' | awk -F: '/\"downloadTotal\"/{d=$2} /\"uploadTotal\"/{u=$2} /\"id\": ?\"/{n++} END{print d+0, u+0, n+0}'")), ' ');
	res.traffic = { down: +t[0], up: +t[1], conns: +t[2] };
	res.ts = time();

	return res;
}

function nikki_set(req) {
	const a = req.args ?? {};
	const action = a.action;

	if (!access(NIKKI_INIT, 'x'))
		return { error: 'nikki' };

	if (action == 'service') {
		const on = !!a.on;
		system('uci -q set nikki.config.enabled=' + (on ? '1' : '0') + ' && uci -q commit nikki');
		system('(' + NIKKI_INIT + ' ' + (on ? 'restart' : 'stop') + ') >/dev/null 2>&1 </dev/null &');
		return { ok: true };
	}

	const c = controller();
	if (!c)
		return { error: 'api' };

	if (action == 'select') {
		if (type(a.group) != 'string' || type(a.name) != 'string')
			return { error: 'args' };
		api(c, 'PUT', '/proxies/' + urlencode(a.group), { name: a.name });
		return { ok: true };
	}

	if (action == 'mode') {
		if (!(a.mode in [ 'rule', 'global', 'direct' ]))
			return { error: 'args' };
		api(c, 'PATCH', '/configs', { mode: a.mode });
		return { ok: true };
	}

	if (action == 'delay') {
		if (type(a.name) != 'string')
			return { error: 'args' };
		const r = api(c, 'GET', '/proxies/' + urlencode(a.name) + '/delay?timeout=5000&url=' + urlencode(DELAY_URL));
		return { delay: r?.delay ?? 0 };
	}

	if (action == 'group_delay') {
		if (type(a.group) != 'string')
			return { error: 'args' };
		return { delays: api(c, 'GET', '/group/' + urlencode(a.group) + '/delay?timeout=5000&url=' + urlencode(DELAY_URL)) };
	}

	return { error: 'action' };
}

return {
	'404mode': {
		weather: {
			args: { city: 'city' },
			call: function(req) {
				const city = trim(req.args?.city ?? '');

				if (!length(city) || length(city) > 64)
					return { error: 'city' };

				return answer('wx-' + substr(replace(urlencode(lc(city)), '%', ''), 0, 96), 1800,
					'weather ' + shellquote(city));
			}
		},

		rates: {
			call: function() { return answer('rates', 3600, 'rates'); }
		},

		news: {
			call: function() { return answer('news', 1200, 'news'); }
		},

		proxy: {
			call: function() { return nikki_state(); }
		},

		proxy_set: {
			args: { action: 'action', group: 'group', name: 'name', mode: 'mode', on: false },
			call: function(req) { return nikki_set(req); }
		}
	}
};
