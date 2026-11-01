/*!
 * 404 MODE — foreign UI adapter
 *
 * Third-party LuCI apps (fan control, SMS forwarders, gateway switches, …)
 * often ship their own CSS: white cards, blue/green buttons, pastel boxes,
 * gradient progress bars, bright charts. This script finds such elements by
 * their computed colours and tags them with data-nfx="…"; the theme CSS then
 * repaints them with its own tokens (cascade.css, "foreign UI adapter").
 *
 *  - only colours that are not part of the active theme palette are touched
 *  - tags live in a data attribute, so Vue/React re-renders keep them
 *  - an element that changes class/style is re-evaluated (e.g. mode toggles)
 *
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */
(function() {
	'use strict';

	var root = document.documentElement;

	if (!root.hasAttribute('data-theme') || window.__404nfx)
		return;

	window.__404nfx = true;

	/* chrome and LuCI widgets the theme already paints */
	var SKIP = [
		'header.hud', '.sidebar', 'footer', '.hud-ticker', '.shell-mask',
		'.gd', '.gost-plate', '.gost-radar', '.login', '.login-mark',
		'.alert-message', '.cbi-progressbar', '.ifacebox', '.zonebadge',
		'.cbi-tooltip', '.cbi-dropdown', '.dropdown-menu', '.cbi-tabmenu',
		'.tabs', '#tabmenu', '.cbi-page-actions', '.cbi-button.important',
		'.btn.important', '#indicators', 'iframe', 'svg *', 'noscript'
	].join(',');

	var BTN = 'button, input[type="button"], input[type="submit"], input[type="reset"], a[class*="btn"], a[class*="button"], [role="button"], [class*="btn"], [class*="button"]';
	var FORM = 'input, select, textarea, option, optgroup';
	var IGNORE = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, BR: 1, HR: 1, TEMPLATE: 1, OPTION: 1, PATH: 1, G: 1 };

	/* ---------- colour helpers ---------- */

	var probe;

	function parse(str) {
		var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(str || '');

		if (!m)
			return null;

		var a = (m[4] == null) ? 1 : (m[4].slice(-1) == '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));

		return { r: +m[1], g: +m[2], b: +m[3], a: a };
	}

	function resolve(value) {
		if (!probe) {
			probe = document.createElement('i');
			probe.style.display = 'none';
			document.body.appendChild(probe);
		}

		probe.style.color = '';
		probe.style.color = value;

		return probe.style.color ? parse(getComputedStyle(probe).color) : null;
	}

	function hsl(c) {
		var r = c.r / 255, g = c.g / 255, b = c.b / 255,
		    max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;

		if (d) {
			if (max == r) h = ((g - b) / d) % 6;
			else if (max == g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h = (h * 60 + 360) % 360;
		}

		return { h: h, c: d, l: (max + min) / 2 };
	}

	function hue(c) {
		var h = hsl(c).h;

		if (h >= 75 && h < 165) return 'ok';
		if (h >= 165 && h < 330) return 'acc';
		if (h >= 15 && h < 75) return 'warn';
		return 'bad';
	}

	/* theme palette: every --n-* / --g-* colour of the active scheme, plus a
	   few literal colours the theme uses on its own buttons */
	var palette = [], paletteKey = '';

	function buildPalette() {
		var key = root.getAttribute('data-skin') + '/' + root.getAttribute('data-theme');

		if (key == paletteKey)
			return;

		paletteKey = key;
		palette = [];

		var cs = getComputedStyle(document.body);

		for (var i = 0; i < cs.length; i++) {
			var name = cs[i];

			if (name.indexOf('--n-') && name.indexOf('--g-') && name.indexOf('--qs-'))
				continue;

			var v = cs.getPropertyValue(name).trim(), c = null;

			if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v))
				c = parse('rgb(' + v + ')');
			else if (v && v.length < 60 && !/gradient|url\(|var\(|\s{2}/.test(v))
				c = resolve(v);

			if (c)
				palette.push(c);
		}

		['#b3c879', '#7f9447', '#b93427', '#7e1f16'].forEach(function(v) {
			var c = resolve(v);
			if (c) palette.push(c);
		});
	}

	/* pure white / near-white greys never count as theme backgrounds: the
	   theme's light surfaces are warm paper and enamel, not #fff */
	function themed(c, isBg) {
		if (isBg) {
			var k = hsl(c);
			if (k.l > .94 && k.c < .025)
				return false;
		}

		for (var i = 0; i < palette.length; i++) {
			var p = palette[i];
			if (Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 21)
				return true;
		}

		return false;
	}

	/* colours of a background-image gradient that are actually visible */
	function gradientColours(img) {
		if (!img || img == 'none' || img.indexOf('gradient') < 0)
			return [];

		var out = [], re = /rgba?\([^)]*\)/g, m;

		while ((m = re.exec(img)) != null) {
			var c = parse(m[0]);
			if (c && c.a >= .5) out.push(c);
		}

		return out;
	}

	function average(list) {
		var r = 0, g = 0, b = 0;
		list.forEach(function(c) { r += c.r; g += c.g; b += c.b; });
		return { r: r / list.length, g: g / list.length, b: b / list.length, a: 1 };
	}

	function hasText(el) {
		for (var n = el.firstChild; n; n = n.nextSibling)
			if (n.nodeType == 3 && /\S/.test(n.nodeValue))
				return true;

		return false;
	}

	/* ---------- classification (read-only) ---------- */

	/* cards found in the current read phase are not tagged yet */
	var cards = new Set();

	function inCard(el) {
		for (var x = el.parentElement; x; x = x.parentElement)
			if (cards.has(x) || x.matches('[data-nfx~="surface"], [data-nfx~="note"]'))
				return true;

		return false;
	}

	function classify(el) {
		if (IGNORE[el.tagName.toUpperCase()] || el.closest(SKIP))
			return null;

		var cs = getComputedStyle(el);

		if (cs.display == 'none')
			return null;

		var tags = [],
		    rect = el.getBoundingClientRect(),
		    w = rect.width, h = rect.height,
		    bg = parse(cs.backgroundColor),
		    grad = gradientColours(cs.backgroundImage),
		    fill = null;

		if (bg && bg.a >= .5 && !themed(bg, true))
			fill = bg;

		if (!fill && grad.length) {
			var foreign = grad.filter(function(c) { return !themed(c, true); });
			if (foreign.length) fill = average(foreign);
		}

		var tag = el.tagName.toUpperCase(),
		    isForm = el.matches(FORM),
		    isBtn = !isForm || /^(button|submit|reset)$/i.test(el.type || '');

		isBtn = isBtn && el.matches(BTN) && h > 0 && h <= 64 && w <= 420 &&
			(tag == 'BUTTON' || tag == 'INPUT' || tag == 'A' || el.textContent.trim().length > 0) &&
			!el.querySelector('button, input, select, textarea');

		if (isBtn) {
			var tcb = parse(cs.color);

			if (fill)
				tags.push('btn', (hsl(fill).c > .15) ? 'b-' + hue(fill) : 'b-plain');
			else if (tcb && tcb.a >= .95 && !themed(tcb) && hsl(tcb).c > .2)
				tags.push('btn', 'b-' + hue(tcb));
		}
		else if (!isForm && fill && w > 0 && h > 0) {
			var k2 = hsl(fill);

			if (w <= 18 && h <= 18 && el.children.length == 0 && !hasText(el) && k2.c > .12)
				tags.push('dot', 'd-' + hue(fill));
			else if (h <= 22 && w >= 1 && el.children.length == 0 && !hasText(el) && (k2.c > .12 || grad.length))
				tags.push('bar');
			else if (h <= 22 && w >= 24 && el.children.length == 0 && !hasText(el))
				tags.push('track');
			else if (h <= 22 && w >= 24 && k2.l > .8 && k2.c < .1)
				tags.push('track');
			else if (h <= 34 && w <= 220 && k2.c > .12 && el.textContent.trim().length)
				tags.push('badge', 't-' + hue(fill));
			else if (w * h >= 3000) {
				if (k2.c > .12 && k2.l > .82)
					tags.push('note');
				else
					tags.push('surface');
			}
		}

		/* text colour */
		if (!isForm && hasText(el) && tags.indexOf('badge') < 0 && !el.matches(BTN)) {
			var tc = parse(cs.color);

			var card = inCard(el) || tags.indexOf('surface') > -1 || tags.indexOf('note') > -1;

			if (tc && tc.a >= .95 && (card || !themed(tc))) {
				var k3 = hsl(tc);

				if (k3.c > .2)
					tags.push('t-' + hue(tc));
				else
					tags.push((parseInt(cs.fontWeight, 10) >= 600 && parseFloat(cs.fontSize) >= 15) ? 'ink-strong' : 'ink');
			}
		}

		/* coloured or light rules and outlines */
		if (!isForm && tags.indexOf('btn') < 0) {
			var sides = ['Top', 'Right', 'Bottom', 'Left'];

			for (var i = 0; i < 4; i++) {
				if (parseFloat(cs['border' + sides[i] + 'Width']) > 0 && cs['border' + sides[i] + 'Style'] != 'none') {
					var bc = parse(cs['border' + sides[i] + 'Color']);

					if (bc && bc.a >= .3 && !themed(bc)) {
						tags.push('edge');
						break;
					}
				}
			}
		}

		/* charts drawn inside a repainted card */
		if ((tag == 'CANVAS' || tag == 'SVG') && w >= 120 && h >= 60 && inCard(el))
			tags.push('chart');

		if (tags.indexOf('surface') > -1 || tags.indexOf('note') > -1)
			cards.add(el);

		return tags.length ? tags.join(' ') : '';
	}

	/* ---------- scanning ---------- */

	var seen = new WeakSet();

	function scan(list, force) {
		buildPalette();

		var todo = [];

		/* a re-check reads colours right after our tag was dropped: skip the
		   transitions that would otherwise report a half-way colour */
		if (force && typeof CSSTransition == 'function') {
			for (var f = 0; f < list.length; f++) {
				var el0 = list[f];

				if (!el0.isConnected || !el0.getAnimations)
					continue;

				getComputedStyle(el0).backgroundColor;

				el0.getAnimations().forEach(function(a) {
					if (a instanceof CSSTransition)
						try { a.finish(); } catch (e) {}
				});
			}
		}

		/* read phase: no DOM writes in between, so one style recalc */
		for (var i = 0; i < list.length; i++) {
			var el = list[i];

			/* a tagged element shows our colours now; only a forced re-check
			   (which drops the tag first) may classify it again */
			if (!el.isConnected || (!force && (seen.has(el) || el.hasAttribute('data-nfx'))))
				continue;

			seen.add(el);

			var t = classify(el);

			if (t !== null && t !== (el.getAttribute('data-nfx') || ''))
				todo.push([el, t]);
		}

		cards.clear();

		/* write phase */
		for (var j = 0; j < todo.length; j++) {
			if (todo[j][1])
				todo[j][0].setAttribute('data-nfx', todo[j][1]);
			else
				todo[j][0].removeAttribute('data-nfx');
		}
	}

	function scope() {
		return document.getElementById('maincontent') || document.body;
	}

	function all(node) {
		var list = [node];
		if (node.querySelectorAll)
			list.push.apply(list, node.querySelectorAll('*'));
		return list;
	}

	var pendingNodes = [], pendingRe = [], timer = null;

	function flush() {
		timer = null;

		/* re-evaluate changed elements: drop our tag first so their own colours show */
		if (pendingRe.length) {
			var re = pendingRe.filter(function(el, i, a) { return a.indexOf(el) == i && el.isConnected; });
			pendingRe = [];
			re.forEach(function(el) { el.removeAttribute('data-nfx'); });
			scan(re, true);
		}

		if (pendingNodes.length) {
			var nodes = pendingNodes;
			pendingNodes = [];

			var list = [];
			nodes.forEach(function(n) { if (n.nodeType == 1 && n.isConnected) list.push.apply(list, all(n)); });
			scan(list, false);
		}
	}

	function queue() {
		if (!timer)
			timer = window.setTimeout(flush, 120);
	}

	function start() {
		scan(all(scope()), false);

		/* modals and popups that apps append to <body> */
		Array.prototype.forEach.call(document.body.children, function(n) {
			if (n !== scope() && !n.matches('header, .shell, footer, script, style') && !n.contains(scope()))
				scan(all(n), false);
		});

		new MutationObserver(function(muts) {
			for (var i = 0; i < muts.length; i++) {
				var m = muts[i];

				if (m.type == 'childList') {
					for (var j = 0; j < m.addedNodes.length; j++)
						if (m.addedNodes[j].nodeType == 1)
							pendingNodes.push(m.addedNodes[j]);
				}
				else if (m.target.nodeType == 1 && !m.target.closest(SKIP)) {
					pendingRe.push(m.target);
				}
			}

			if (pendingNodes.length || pendingRe.length)
				queue();
		}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

		/* a scheme switch changes the palette: re-check every tagged element */
		document.addEventListener('404mode-scheme', function() {
			paletteKey = '';
			pendingRe.push.apply(pendingRe, document.querySelectorAll('[data-nfx]'));
			queue();
		});
	}

	if (document.readyState == 'loading')
		document.addEventListener('DOMContentLoaded', start);
	else
		start();

	window.addEventListener('load', function() {
		pendingNodes.push(scope());
		seen = new WeakSet();
		queue();
	});
})();
