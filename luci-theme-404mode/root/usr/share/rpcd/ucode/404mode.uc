/*
 * 404 Mode — header brief: weather, exchange rates, headlines.
 *
 * ubus object "404mode" (rpcd ucode plugin), read-only:
 *   weather { city }  current weather for a city      (Open-Meteo, no key)
 *   rates             USD / EUR / CNY to RUB           (CBR daily, cbr-xml-daily.ru)
 *   news              latest headlines                 (OpenNet, Habr RSS)
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

import { readfile, stat } from 'fs';

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
		}
	}
};
