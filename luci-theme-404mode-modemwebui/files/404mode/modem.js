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
	}

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
