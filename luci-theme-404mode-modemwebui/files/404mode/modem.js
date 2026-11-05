/*!
 * 404 MODE — Modem WebUI bridge
 * Applies the LuCI 404 Mode skin/scheme to the modem panel (:8001).
 *  - inside the LuCI iframe: asks the parent page for its state via postMessage
 *  - standalone: last known state (localStorage of :8001), else install-time default
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */
(function() {
	'use strict';

	var KEY = '404mode.modem';
	var root = document.documentElement;
	var embedded = (window.parent && window.parent !== window);
	var answered = false;

	function load() {
		try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
	}

	function save(st) {
		try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
	}

	function prefersDark() {
		try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; }
	}

	function apply(st) {
		if (!st || st.skin == 'off') {
			root.removeAttribute('data-404');
			root.removeAttribute('data-404-theme');
			return;
		}

		var theme = (st.theme == 'light' || st.theme == 'dark') ? st.theme : (prefersDark() ? 'dark' : 'light');

		root.setAttribute('data-404', st.skin == 'gost' ? 'gost' : 'base');
		root.setAttribute('data-404-theme', theme);
		root.classList.toggle('m404-nofx', st.fx === false);
		if (typeof scanCharts == 'function')
			window.setTimeout(scanCharts, 50);
	}


	/* ---------- chart ink: invert a canvas only when its labels clash ----------
	   The panel draws axes and legends in dark ink on a light theme and in light
	   ink once its own dark mode is on. Sample the neutral (grey) pixels of each
	   chart and tag it, so the CSS inverts only charts whose ink would vanish. */
	function inkOf(c) {
		var w = c.width, h = c.height;
		if (!w || !h)
			return null;

		var data;
		try { data = c.getContext('2d').getImageData(0, 0, w, h).data; } catch (e) { return null; }

		var step = Math.max(4, Math.floor(data.length / 4 / 6000)) * 4, sum = 0, n = 0;

		for (var i = 0; i < data.length; i += step) {
			var a = data[i + 3];
			if (a < 60)
				continue;
			var r = data[i], g = data[i + 1], b = data[i + 2];
			var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
			if (mx - mn > 28)
				continue;	/* coloured: a series, not ink */
			sum += (r + g + b) / 3;
			n++;
		}

		return n < 12 ? null : (sum / n > 128 ? 'light' : 'dark');
	}

	function scanCharts() {
		var theme = root.getAttribute('data-404-theme');
		var list = document.getElementsByTagName('canvas');

		for (var i = 0; i < list.length; i++) {
			var ink = inkOf(list[i]);
			if (!ink)
				continue;
			list[i].setAttribute('data-404-ink', ink);
			list[i].setAttribute('data-404-flip', (theme == 'dark' && ink == 'dark') || (theme == 'light' && ink == 'light') ? '1' : '0');
		}
	}

	/* ---------- operator: "25002" → "МегаФон" ---------- */
	var RU = /^ru/i.test(navigator.language || '') || /ru/i.test(document.documentElement.lang || '');
	var PLMN = {
		'25001': [ 'МТС', 'MTS' ], '25002': [ 'МегаФон', 'MegaFon' ], '25099': [ 'Билайн', 'Beeline' ], '25028': [ 'Билайн', 'Beeline' ],
		'25020': [ 'T2', 'T2' ], '25011': [ 'Yota', 'Yota' ], '25062': [ 'Т-Мобайл', 'T-Mobile' ], '25035': [ 'Мотив', 'Motiv' ],
		'25039': [ 'Ростелеком', 'Rostelecom' ], '25027': [ 'Летай', 'Letai' ], '25032': [ 'Win mobile', 'Win mobile' ],
		'25060': [ 'Волна мобайл', 'Volna mobile' ], '25701': [ 'A1', 'A1' ], '25702': [ 'МТС', 'MTS' ],
		'40101': [ 'Beeline', 'Beeline' ], '40102': [ 'Kcell', 'Kcell' ], '40107': [ 'Altel', 'Altel' ], '40177': [ 'Tele2', 'Tele2' ]
	};

	function opfix(node) {
		var walker = document.createTreeWalker(node || document.body, NodeFilter.SHOW_TEXT, null);
		var t;
		while ((t = walker.nextNode())) {
			var m = /^\s*(\d{3})[\s-]?(\d{2,3})\s*$/.exec(t.nodeValue);
			if (!m || !PLMN[m[1] + m[2]] || !t.parentNode || t.parentNode.closest('input, textarea, script, style'))
				continue;
			var el = t.parentNode;
			el.setAttribute('data-404-op', m[1] + m[2]);
			el.setAttribute('title', 'PLMN ' + m[1] + m[2]);
			t.nodeValue = PLMN[m[1] + m[2]][RU ? 0 : 1];
		}
	}

	function start() {
		if (!document.body)
			return window.setTimeout(start, 200);
		opfix(document.body);
		new MutationObserver(function(list) {
			if (!root.getAttribute('data-404'))
				return;
			for (var i = 0; i < list.length; i++) {
				var n = list[i].target;
				opfix(n.nodeType == 3 ? n.parentNode : n);
			}
		}).observe(document.body, { subtree: true, childList: true, characterData: true });
		window.setInterval(scanCharts, 2500);
		scanCharts();
	}

	start();

	var def = window.__404modemDefault || { skin: 'base', theme: 'auto' };
	apply(load() || def);

	window.addEventListener('message', function(ev) {
		var d = ev.data;

		if (!d || d.source != '404mode' || ev.source !== window.parent)
			return;

		answered = true;

		var st = { skin: d.skin == 'gost' ? 'gost' : 'base', theme: d.theme, fx: d.fx !== false };
		apply(st);
		save(st);
	});

	if (embedded) {
		try { window.parent.postMessage({ source: '404mode-client', v: 1 }, '*'); } catch (e) {}

		/* parent is not a 404 Mode page (another LuCI theme): stay stock */
		window.setTimeout(function() {
			if (!answered)
				apply({ skin: 'off' });
		}, 2500);
	}
})();
