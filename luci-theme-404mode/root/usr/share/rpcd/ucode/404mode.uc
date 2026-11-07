/*
 * 404 Mode — header brief: weather, exchange rates, headlines.
 *
 * ubus object "404mode" (rpcd ucode plugin):
 *   weather { city }  current weather for a city      (Open-Meteo, no key)
 *   rates             USD / EUR / CNY to RUB           (CBR daily, cbr-xml-daily.ru)
 *   news              latest headlines                 (OpenNet, Habr RSS)
 *   proxy             Nikki / mihomo state: service, mode, groups, nodes,
 *                     the node in use, traffic totals    (mihomo REST API)
 *   cell { mcc, mnc, lac, cid }
 *                     where the serving tower stands (open cell database
 *                     api.mylnikov.org, cached for a month)
 *   status            internet, proxy node, cell and system in one answer
 *                     (the phone app and widget read it via /cgi-bin/404status)
 *   app               the phone app token, HTTPS domain and certificate date
 *   app_set { action: "rotate" }
 *                     a new token: phones with the old one stop reading
 *   ttl               TTL / hop limit fixed on the modem link
 *   ttl_set { out, in, dev }
 *                     write /etc/nftables.d/90-404mode-ttl.nft, reload fw4
 *                     (0 and 0 removes it)
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

/* ---------- tower location ---------- */

function cell_lookup(a) {
	const num = (v) => (type(v) == 'string' && match(v, /^[0-9]{1,12}$/)) ? v : null;
	const mcc = num(a.mcc), mnc = num(a.mnc), cid = num(a.cid);
	const lacs = filter(type(a.lac) == 'array' ? a.lac : [ a.lac ], (v) => num(v));

	if (!mcc || !mnc || !cid)
		return { error: 'args' };

	const key = DIR + '/cell-' + mcc + '-' + mnc + '-' + cid + '.json';
	const st = stat(key);
	if (st && time() - st.mtime < 30 * 86400) {
		try { return json(readfile(key)); } catch (e) {}
	}

	system('mkdir -p ' + DIR);

	let res = { found: false };
	for (let lac in length(lacs) ? lacs : [ '0' ]) {
		const out = trim(sh('uclient-fetch -q -T 8 -O - ' + shellquote('https://api.mylnikov.org/geolocation/cell?v=1.1&data=open&mcc=' + mcc + '&mnc=' + int(mnc) + '&lac=' + lac + '&cellid=' + cid) + ' 2>/dev/null'));
		let j = null;
		try { j = json(out); } catch (e) { j = null; }
		if (j?.result == 200 && j.data?.lat) {
			res = { found: true, lat: j.data.lat, lon: j.data.lon, range: j.data.range };
			break;
		}
		if (!length(out)) {
			res = { found: false, offline: true };
			break;
		}
	}

	if (!res.offline)
		writefile(key, sprintf('%J', res));

	return res;
}

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

	/* nodes from proxy-providers are listed only under /providers/proxies */
	const prov = api(c, 'GET', '/providers/proxies')?.providers ?? {};
	res.providers = [];
	for (let pn in keys(prov)) {
		const pv = prov[pn];
		for (let p in (pv?.proxies ?? []))
			if (p?.name && !all[p.name])
				all[p.name] = p;
		/* "default" holds the profile's own proxies: not a subscription */
		if (pv?.vehicleType && pv.vehicleType != 'Compatible')
			push(res.providers, {
				name: pn,
				vehicle: pv.vehicleType,
				count: length(pv.proxies ?? []),
				alive: length(filter(pv.proxies ?? [], (x) => (last_delay(x) ?? 0) > 0)),
				updated: pv.updatedAt,
				sub: pv.subscriptionInfo
			});
	}

	const rprov = api(c, 'GET', '/providers/rules')?.providers ?? {};
	res.rules = [];
	for (let rn in keys(rprov))
		push(res.rules, {
			name: rn,
			vehicle: rprov[rn]?.vehicleType,
			behavior: rprov[rn]?.behavior,
			count: rprov[rn]?.ruleCount,
			updated: rprov[rn]?.updatedAt
		});

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
			fixed: g.fixed,
			hidden: !!g.hidden,
			icon: g.icon,
			delay: last_delay(g),
			all: map(g.all ?? [], (n) => ({
				name: n,
				type: all[n]?.type,
				udp: !!all[n]?.udp,
				xudp: !!all[n]?.xudp,
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
	add('GLOBAL');

	res.groups = groups;

	/* the main group: the first selector the user can switch */
	let main = null;
	for (let g in groups)
		if (g.type == 'Selector' && !g.hidden && g.name != 'GLOBAL') { main = g.name; break; }
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
		res.node = { name: chain[-1], type: leaf.type, udp: !!leaf.udp, xudp: !!leaf.xudp, delay: last_delay(leaf) };

	/* a group in the chain that tests by itself knows the delay too */
	if (res.node && !res.node.delay)
		for (let i = length(chain) - 2; i >= 0; i--)
			if (last_delay(all[chain[i]])) { res.node.delay = last_delay(all[chain[i]]); break; }

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

	if (action == 'subscription') {
		const subs = [];
		for (let line in split(trim(sh("uci -q show nikki 2>/dev/null | grep '=subscription$' | cut -d. -f2 | cut -d= -f1")), '\n'))
			if (length(line))
				push(subs, line);
		for (let sec in subs)
			system('(/etc/init.d/nikki update_subscription ' + shellquote(sec) + ') >/dev/null 2>&1 </dev/null &');
		return { ok: true, count: length(subs) };
	}

	const c = controller();
	if (!c)
		return { error: 'api' };

	if (action == 'select') {
		if (type(a.group) != 'string' || type(a.name) != 'string')
			return { error: 'args' };
		const r = api(c, 'PUT', '/proxies/' + urlencode(a.group), { name: a.name });
		return r?.message ? { error: r.message } : { ok: true };
	}

	/* URLTest / Fallback: drop the pinned node, back to automatic choice */
	if (action == 'unfix') {
		if (type(a.group) != 'string')
			return { error: 'args' };
		api(c, 'DELETE', '/proxies/' + urlencode(a.group));
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

	if (action == 'provider_update' || action == 'provider_check' || action == 'rules_update') {
		if (type(a.name) != 'string')
			return { error: 'args' };
		if (action == 'rules_update')
			api(c, 'PUT', '/providers/rules/' + urlencode(a.name));
		else if (action == 'provider_update')
			api(c, 'PUT', '/providers/proxies/' + urlencode(a.name));
		else
			api(c, 'GET', '/providers/proxies/' + urlencode(a.name) + '/healthcheck');
		return { ok: true };
	}

	if (action == 'close_conns') {
		api(c, 'DELETE', '/connections');
		return { ok: true };
	}

	if (action == 'flush_fakeip') {
		api(c, 'POST', '/cache/fakeip/flush');
		return { ok: true };
	}

	if (action == 'restart') {
		system('(' + NIKKI_INIT + ' restart) >/dev/null 2>&1 </dev/null &');
		return { ok: true };
	}

	/* the web dashboard (zashboard / metacubexd) bundled with Nikki, with
	   host, port and secret so it opens already connected */
	if (action == 'dashboard') {
		let raw = null;
		try {
			raw = json(sh("yq -M -p yaml -o json '{\"ui\": .\"external-ui-name\", \"api\": .\"external-controller\", \"tls\": .\"external-controller-tls\"}' " + NIKKI_RUN + ' 2>/dev/null'));
		} catch (e) { raw = null; }
		const listen = raw?.tls ?? raw?.api;
		const port = listen ? match(listen, /:(\d+)$/) : null;
		return { port: port ? port[1] : '9090', tls: !!raw?.tls, ui: raw?.ui, secret: c.secret };
	}

	if (action == 'group_delay') {
		if (type(a.group) != 'string')
			return { error: 'args' };
		return { delays: api(c, 'GET', '/group/' + urlencode(a.group) + '/delay?timeout=5000&url=' + urlencode(DELAY_URL)) };
	}

	return { error: 'action' };
}

/* ---------- TTL / hop limit on the modem link ---------- */

const TTL_FILE = '/etc/nftables.d/90-404mode-ttl.nft';

function ttl_state() {
	const raw = readfile(TTL_FILE);
	const m = raw ? match(raw, /# 404mode-ttl out=([0-9]+) in=([0-9]+) dev=([^\n]*)/) : null;
	const live = trim(sh('nft list chain inet fw4 ttl404_post 2>/dev/null; nft list chain inet fw4 ttl404_pre 2>/dev/null'));

	return {
		out: m ? +m[1] : 0,
		in: m ? +m[2] : 0,
		dev: m ? split(trim(m[3]), ' ') : [],
		active: length(live) > 0,
		nft: access('/usr/sbin/nft') || access('/sbin/nft')
	};
}

function ttl_set(a) {
	const out = +(a.out ?? 0), inn = +(a.in ?? 0);
	let dev = [];

	for (let d in split(replace(a.dev ?? '', ',', ' '), ' ')) {
		if (!length(d))
			continue;
		if (!match(d, /^[A-Za-z0-9_.-]{1,15}$/))
			return { error: 'dev' };
		push(dev, d);
	}

	if (out != out || inn != inn || out < 0 || out > 255 || inn < 0 || inn > 255)
		return { error: 'value' };

	if (!out && !inn)
		system('rm -f ' + TTL_FILE);
	else {
		if (!length(dev))
			return { error: 'dev' };

		const set = '{ ' + join(', ', map(dev, d => '"' + d + '"')) + ' }';
		let nft = '# 404mode-ttl out=' + out + ' in=' + inn + ' dev=' + join(' ', dev) + '\n' +
			'# written by the 404 Mode modem page; delete the file to undo\n';

		if (out)
			nft += 'chain ttl404_post {\n\ttype filter hook postrouting priority mangle + 10; policy accept;\n' +
				'\toifname ' + set + ' ip ttl set ' + out + '\n' +
				'\toifname ' + set + ' ip6 hoplimit set ' + out + '\n}\n';
		if (inn)
			nft += 'chain ttl404_pre {\n\ttype filter hook prerouting priority mangle + 10; policy accept;\n' +
				'\tiifname ' + set + ' ip ttl set ' + inn + '\n' +
				'\tiifname ' + set + ' ip6 hoplimit set ' + inn + '\n}\n';

		system('mkdir -p /etc/nftables.d');
		if (!writefile(TTL_FILE, nft))
			return { error: 'write' };
	}

	const rc = system('fw4 -q reload >/dev/null 2>&1');
	if (rc != 0) {
		system('rm -f ' + TTL_FILE + '; fw4 -q reload >/dev/null 2>&1');
		return { error: 'nft' };
	}

	return ttl_state();
}

/* ---------- phone app: one short status for the PWA and the widget ---------- */

const ST_DIR = '/tmp/404mode-status';
const APP_DIR = '/etc/404mode';
const TOKEN_FILE = APP_DIR + '/token';
const DOMAIN_FILE = APP_DIR + '/domain';

function cached(key, ttl, fn) {
	const file = ST_DIR + '/' + key + '.json';
	let c = null;
	try { c = json(readfile(file)); } catch (e) { c = null; }
	if (c && time() - (c.ts ?? 0) < ttl)
		return c.v;
	const v = fn();
	system('mkdir -p ' + ST_DIR);
	writefile(file, sprintf('%J', { ts: time(), v: v }));
	return v;
}

function ubus_json(obj, method, args) {
	let out = null;
	try { out = json(sh('ubus -t 8 call ' + obj + ' ' + method + ' ' + shellquote(sprintf('%J', args ?? {})) + ' 2>/dev/null')); } catch (e) { out = null; }
	return out;
}

/* internet: one ping is enough, either target */
function net_probe() {
	for (let host in [ '77.88.8.8', '1.1.1.1' ]) {
		const out = sh('ping -c 1 -W 2 -q ' + host + ' 2>/dev/null');
		const m = match(out, /= [0-9.]+\/([0-9.]+)\//);
		if (m)
			return { online: true, ping: int(+m[1] + 0.5), target: host };
	}
	return { online: false, ping: null, target: null };
}

/* the uplink: the default route with the lowest metric */
function uplink() {
	let best = null;
	for (let line in split(sh('ip -4 route show default 2>/dev/null'), '\n')) {
		const dev = match(line, /dev (\S+)/);
		if (!dev)
			continue;
		const met = match(line, /metric (\d+)/);
		const m = met ? +met[1] : 0;
		if (!best || m < best.metric)
			best = { dev: dev[1], metric: m };
	}
	if (!best)
		return null;

	/* the logical interface name people know (wan, USB, …) */
	const dump = ubus_json('network.interface', 'dump');
	for (let i in (dump?.interface ?? []))
		if ((i.l3_device ?? i.device) == best.dev && i.up) {
			best.iface = i.interface;
			break;
		}

	/* bytes per second since the previous call */
	const now = +split(readfile('/proc/uptime') ?? '0', ' ')[0];
	let rx = null, tx = null;
	for (let line in split(readfile('/proc/net/dev') ?? '', '\n')) {
		const m = match(line, /^\s*([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
		if (m && m[1] == best.dev) { rx = +m[2]; tx = +m[3]; break; }
	}
	if (rx != null) {
		const file = ST_DIR + '/rate.json';
		let p = null;
		try { p = json(readfile(file)); } catch (e) { p = null; }
		if (p && p.dev == best.dev && now > p.t && rx >= p.rx && tx >= p.tx) {
			best.down = int((rx - p.rx) / (now - p.t));
			best.up = int((tx - p.tx) / (now - p.t));
		}
		if (!p || now - p.t >= 1) {
			system('mkdir -p ' + ST_DIR);
			writefile(file, sprintf('%J', { dev: best.dev, t: now, rx: rx, tx: tx }));
		}
	}
	return best;
}

function proxy_brief() {
	if (!access(NIKKI_INIT, 'x'))
		return { installed: false };

	const res = { installed: true, running: length(trim(sh('pidof mihomo 2>/dev/null'))) > 0 };
	const c = res.running ? controller() : null;
	if (!c)
		return res;

	res.mode = api(c, 'GET', '/configs')?.mode;
	const all = api(c, 'GET', '/proxies')?.proxies;
	if (!all)
		return res;

	let main = null;
	for (let n in (all.GLOBAL?.all ?? []))
		if (all[n]?.type == 'Selector' && !all[n]?.hidden) { main = n; break; }
	if (!main)
		main = 'GLOBAL';
	if (res.mode == 'global')
		main = 'GLOBAL';
	if (res.mode == 'direct') {
		res.direct = true;
		return res;
	}

	const chain = [];
	let cur = main;
	while (cur && length(chain) < 8) {
		push(chain, cur);
		const p = all[cur];
		if (!p || !GROUPS[p.type] || !p.now)
			break;
		cur = p.now;
	}
	res.group = main;
	res.chain = chain;

	const leafName = chain[-1];
	const leaf = all[leafName];
	res.node = leafName;
	res.type = leaf?.type;
	res.delay = last_delay(leaf);
	if (!res.delay)
		for (let i = length(chain) - 2; i >= 0; i--)
			if (last_delay(all[chain[i]])) { res.delay = last_delay(all[chain[i]]); break; }

	/* nodes from subscriptions are listed only under /providers/proxies */
	if (leafName && !leaf) {
		const prov = api(c, 'GET', '/providers/proxies')?.providers ?? {};
		for (let pn in keys(prov))
			for (let p in (prov[pn]?.proxies ?? []))
				if (p?.name == leafName) { res.type = p.type; res.delay = last_delay(p) || res.delay; }
	}
	return res;
}

const PLMN_RU = {
	'25001': 'МТС', '25002': 'МегаФон', '25099': 'Билайн', '25028': 'Билайн', '25020': 'T2', '25011': 'Yota',
	'25062': 'Т-Мобайл', '25035': 'Мотив', '25039': 'Ростелеком', '25027': 'Летай', '25032': 'Win mobile', '25060': 'Волна мобайл'
};

const LTE_EARFCN = [ [ 1, 0, 599 ], [ 3, 1200, 1949 ], [ 5, 2400, 2649 ], [ 7, 2750, 3449 ], [ 8, 3450, 3799 ], [ 20, 6150, 6449 ],
	[ 28, 9210, 9659 ], [ 32, 9920, 10359 ], [ 38, 37750, 38249 ], [ 40, 38650, 39649 ], [ 41, 39650, 41589 ], [ 42, 41590, 43589 ], [ 43, 43590, 45589 ] ];
const LTE_RB = { '6': 1.4, '15': 3, '25': 5, '50': 10, '75': 15, '100': 20 };

function modem_section() {
	let first = null;
	const off = {};
	for (let line in split(sh('uci -q show qmodem 2>/dev/null'), '\n')) {
		let m = match(line, /^qmodem\.([^.=]+)=modem-device$/);
		if (m && first == null) { first = m[1]; continue; }
		m = match(line, /^qmodem\.([^.=]+)\.enabled='0'$/);
		if (m) off[m[1]] = true;
	}
	for (let line in split(sh('uci -q show qmodem 2>/dev/null'), '\n')) {
		const m = match(line, /^qmodem\.([^.=]+)=modem-device$/);
		if (m && !off[m[1]])
			return m[1];
	}
	return first;
}

function modem_brief() {
	const sec = modem_section();
	if (!sec)
		return { present: false };

	const list = ubus_json('qmodem', 'info', { config_section: sec })?.modem_info ?? [];
	const have = {};
	for (let e in list) have[e.key + '|' + (e.extra_info ?? '')] = true;
	for (let e in (ubus_json('qmodem', 'cell_info', { config_section: sec })?.modem_info ?? []))
		if (!have[e.key + '|' + (e.extra_info ?? '')]) push(list, e);

	const v = {};
	for (let e in list)
		if (e?.key && e.value != null && e.value != '' && e.value != '-' && v[e.key] == null)
			v[e.key] = '' + e.value;

	const num = (k) => (v[k] != null && match(v[k], /^-?[0-9.]+/)) ? +match(v[k], /^-?[0-9.]+/)[0] : null;

	const res = {
		present: true,
		section: sec,
		name: v.name,
		online: v.connect_status == 'Yes',
		sim: v['SIM Slot'] ? +v['SIM Slot'] || 1 : null,
		sim_ready: match(lc(v['SIM Status'] ?? ''), /ready/) ? true : false,
		plmn: (v.MCC ?? '') + (v.MNC ?? ''),
		rsrp: num('RSRP'),
		rsrq: num('RSRQ'),
		sinr: num('SINR'),
		temp: num('temperature')
	};
	if (!length(res.plmn))
		res.plmn = v.ISP;
	res.operator = PLMN_RU[res.plmn] ?? PLMN_RU[v.ISP] ?? v.ISP;

	const mode = (v.network_mode ?? '') + ' ' + (v['Network Type'] ?? '');
	const nr = match(mode, /NR|5G/) ? true : false;
	const nsa = match(mode, /NSA|EN-DC/) ? true : false;

	/* the bands: every carrier from AT+QCAINFO on Quectel, else the EARFCN */
	let bands = [], scc = 0, idle = 0;
	if (v.at_port && match(lc(v.manufacturer ?? ''), /quectel/)) {
		const r = ubus_json('qmodem', 'send_at', { config_section: sec, params: { port: v.at_port, at: 'AT+QCAINFO' } });
		for (let line in split(r?.at_cfg?.res ?? '', '\n')) {
			const m = match(line, /\+QCAINFO:\s*"(PCC|SCC)",(\d+),(\d+),"(LTE|NR5G) BAND (\d+)"(.*)$/);
			if (!m) continue;
			const is_nr = m[4] == 'NR5G';
			const rest = split(trim(m[6]), ',');
			const active = m[1] == 'PCC' || is_nr || trim(rest[1] ?? '') == '2';
			push(bands, { band: (is_nr ? 'n' : 'B') + m[5], nr: is_nr, pcc: m[1] == 'PCC', active: active,
				bw: is_nr ? null : LTE_RB[m[3]] });
			if (m[1] == 'SCC') { scc++; if (!active) idle++; }
		}
	}
	if (!length(bands)) {
		const ear = num('EARFCN');
		if (ear != null)
			for (let b in LTE_EARFCN)
				if (ear >= b[1] && ear <= b[2]) { push(bands, { band: 'B' + b[0], nr: false, pcc: true, active: true }); break; }
	}

	/* PCC first, then LTE, then NR */
	bands = sort(bands, (a, b) => (b.pcc - a.pcc) || (a.nr - b.nr));
	res.bands = bands;
	if (length(bands)) {
		const head = bands[0];
		let s = (head.nr ? 'NR ' : 'LTE ') + head.band;
		for (let i = 1; i < length(bands); i++)
			s += '+' + (bands[i].nr == head.nr ? substr(bands[i].band, 1) : bands[i].band);
		res.combo = s;
	}

	res.kind = nr && !nsa ? '5G' : (nsa ? '5G NSA' : (scc ? '4G+' : (match(mode, /LTE/) || res.rsrp != null ? 'LTE' : (match(mode, /WCDMA|UMTS|HSPA/) ? '3G' : null))));
	res.ca = scc > 0;
	res.ca_idle = scc > 0 && idle == scc;

	/* 0…4 bars and a 0…100 score from RSRP and SINR */
	if (res.rsrp != null) {
		const p = (x, lo, hi) => x == null ? null : (x <= lo ? 0 : (x >= hi ? 1 : (x - lo) * 1.0 / (hi - lo)));
		const a = p(res.rsrp, -120, -75), b = p(res.sinr, -3, 25);
		res.score = int(100 * (b == null ? a : a * 0.6 + b * 0.4) + 0.5);
		res.bars = res.rsrp >= -85 ? 4 : (res.rsrp >= -95 ? 3 : (res.rsrp >= -105 ? 2 : (res.rsrp >= -115 ? 1 : 0)));
	}
	return res;
}

function sys_brief() {
	const up = +split(readfile('/proc/uptime') ?? '0', ' ')[0];
	const la = split(readfile('/proc/loadavg') ?? '', ' ');
	const mem = {};
	for (let line in split(readfile('/proc/meminfo') ?? '', '\n')) {
		const m = match(line, /^(MemTotal|MemAvailable):\s+(\d+)/);
		if (m) mem[m[1]] = +m[2];
	}
	let temp = null;
	for (let z = 0; z < 4 && temp == null; z++) {
		const t = trim(readfile('/sys/class/thermal/thermal_zone' + z + '/temp') ?? '');
		if (length(t)) temp = int(+t / 100) / 10;
	}
	return {
		host: trim(readfile('/proc/sys/kernel/hostname') ?? ''),
		model: trim(readfile('/tmp/sysinfo/model') ?? ''),
		uptime: int(up),
		load: +la[0],
		mem_total: mem.MemTotal ? int(mem.MemTotal / 1024) : null,
		mem_used: mem.MemTotal ? int((mem.MemTotal - (mem.MemAvailable ?? 0)) / 1024) : null,
		temp: temp,
		lan: split(uci_get('network.lan.ipaddr'), '/')[0] || null,
		domain: trim(readfile(DOMAIN_FILE) ?? '') || null
	};
}

function status_all() {
	const net = cached('net', 15, net_probe);
	const link = uplink();
	if (link) {
		net.via = link.iface ?? link.dev;
		net.dev = link.dev;
		net.down = link.down;
		net.up = link.up;
	}
	return {
		v: 1,
		ts: time(),
		net: net,
		proxy: cached('proxy', 5, proxy_brief),
		cell: cached('cell', 6, modem_brief),
		sys: sys_brief()
	};
}

function app_token(rotate) {
	let t = trim(readfile(TOKEN_FILE) ?? '');
	if (rotate || !match(t, /^[0-9a-f]{32}$/)) {
		const raw = readfile('/dev/urandom', 16) ?? '';
		t = '';
		for (let i = 0; i < length(raw); i++)
			t += sprintf('%02x', ord(raw, i));
		if (!match(t, /^[0-9a-f]{32}$/))
			return null;
		system('mkdir -p ' + APP_DIR + ' && chmod 700 ' + APP_DIR);
		writefile(TOKEN_FILE, t + '\n');
		system('chmod 600 ' + TOKEN_FILE);
	}
	return t;
}

function app_info(rotate) {
	const domain = trim(readfile(DOMAIN_FILE) ?? '');
	const crt = trim(uci_get('uhttpd.main.cert'));
	let expires = null;
	if (length(domain) && length(crt)) {
		const out = sh('openssl x509 -noout -enddate -in ' + shellquote(crt) + ' 2>/dev/null');
		const m = match(out, /notAfter=(.*)/);
		if (m) expires = trim(m[1]);
	}
	return {
		token: app_token(rotate),
		domain: length(domain) ? domain : null,
		expires: expires,
		lan: split(uci_get('network.lan.ipaddr'), '/')[0] || null,
		app: !!access('/www/app/index.html'),
		cgi: !!access('/www/cgi-bin/404status', 'x')
	};
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

		cell: {
			args: { mcc: 'mcc', mnc: 'mnc', lac: 'lac', cid: 'cid' },
			call: function(req) { return cell_lookup(req.args ?? {}); }
		},

		proxy_set: {
			args: { action: 'action', group: 'group', name: 'name', mode: 'mode', on: false },
			call: function(req) { return nikki_set(req); }
		},

		ttl: {
			call: function() { return ttl_state(); }
		},

		status: {
			call: function() { return status_all(); }
		},

		app: {
			call: function() { return app_info(false); }
		},

		app_set: {
			args: { action: 'action' },
			call: function(req) { return req.args?.action == 'rotate' ? app_info(true) : { error: 'action' }; }
		},

		ttl_set: {
			args: { out: 0, in: 0, dev: 'dev' },
			call: function(req) { return ttl_set(req.args ?? {}); }
		}
	}
};
