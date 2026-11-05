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
		'header.hud', '.sidebar', 'footer', '.hud-ticker', '.shell-mask', '.n-ambient', '.n-saver',
		'.gd', '.gost-plate', '.gost-radar', '.login', '.login-mark', '.xd', '.xl', '.hud-search-results',
		'.alert-message', '.cbi-progressbar', '.ifacebox', '.zonebadge',
		'.cbi-tooltip', '.cbi-dropdown', '.dropdown-menu', '.cbi-tabmenu',
		'.tabs', '#tabmenu', '.cbi-page-actions', '.cbi-button.important',
		'.btn.important', '#indicators', 'iframe', 'svg *', 'noscript',
		'#app .tag_up', '#app .tag_dn', '.luci-overlay *'
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

			/* our tokens and the LuCI bootstrap tokens the theme maps */
			if (!/^--(n|g|x|qs|text-color|border-color|background-color|primary-color|on-|error-color|success-color|warn-color|tab-bar)-?/.test(name))
				continue;

			var v = cs.getPropertyValue(name).replace(/\s+/g, ' ').trim(), c = null;

			if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v))
				c = parse('rgb(' + v + ')');
			else if (v && v.length < 120 && !/gradient|url\(|var\(/.test(v))
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
		/* the neon skin's light surfaces are cool porcelain: plain palette match */
		if (root.getAttribute('data-skin') == 'neon') {
			for (var j = 0; j < palette.length; j++) {
				var q = palette[j];
				if (Math.abs(q.r - c.r) + Math.abs(q.g - c.g) + Math.abs(q.b - c.b) < ((c.r + c.g + c.b) / 3 > 205 ? 10 : 21))
					return true;
			}
			return false;
		}

		if (isBg) {
			var k = hsl(c);
			/* pure / cool whites (#fff, #f8fbff, #f0f4f8…) are never ours: the
			   theme's light surfaces are warm paper and enamel (hue 30–65°) */
			if (k.l > .9 && (k.c < .025 || (k.c < .09 && (k.h < 25 || k.h > 140))))
				return false;
		}

		/* light colours: the theme's are warm paper / enamel, an app's are
		   usually cool white (#f4f6f9, #f8fafc): a warm and a cool tint never
		   count as the same colour, and the tolerance is tighter */
		var light = (c.r + c.g + c.b) / 3 > 205;

		for (var i = 0; i < palette.length; i++) {
			var p = palette[i];
			var d = Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b);

			if (light) {
				var wc = c.r - c.b, wp = p.r - p.b;

				if (d >= 10 || (wc <= -3 && wp >= 3) || (wc >= 3 && wp <= -3))
					continue;

				return true;
			}

			if (d < 21)
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
			if (c && (c.a >= .5 || (c.a >= .12 && hsl(c).c > .12))) out.push(c);
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
			if (cards.has(x) || x.matches('[data-nfx~="surface"], [data-nfx~="note"], [data-nfx~="overlay"]'))
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

		/* full-screen foreign backdrop (screensavers, kiosk views): theme ground
		   underneath, so the cards and text repainted on top stay readable */
		if (cs.position == 'fixed' && w >= innerWidth * .9 && h >= innerHeight * .9 &&
		    ((bg && bg.a >= .5 && !themed(bg, true)) || grad.length ||
		     (cs.backdropFilter && cs.backdropFilter != 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter != 'none')) &&
		    !el.matches('#modal_overlay, .shell-mask')) {
			cards.add(el);
			return 'overlay';
		}

		if (bg && bg.a >= .5 && !themed(bg, true))
			fill = bg;
		/* tinted glass (translucent coloured cards) counts too; translucent
		   greys are left alone, the theme uses those itself */
		else if (bg && bg.a >= .12 && hsl(bg).c > .12 && !themed(bg, true))
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

		/* an icon in a little framed square: keep the glyph, drop the frame */
		if (!isForm && !isBtn && w >= 10 && w <= 36 && h >= 10 && h <= 36 && Math.abs(w - h) <= 8 && inCard(el) &&
		    (el.querySelector('img, svg, i, span') || (el.textContent.trim().length > 0 && el.textContent.trim().length <= 2)) &&
		    ((bg && bg.a > .05) || grad.length || parseFloat(cs.borderTopWidth) > 0))
			return 'icon';

		if (isBtn) {
			var tcb = parse(cs.color);

			if (fill)
				tags.push('btn', (hsl(fill).c > .15) ? 'b-' + hue(fill) : 'b-plain');
			else if (tcb && tcb.a >= .95 && !themed(tcb) && hsl(tcb).c > .2)
				tags.push('btn', 'b-' + hue(tcb));
		}
		else if (!isForm && fill && w > 0 && h > 0) {
			var k2 = hsl(fill);

			if (w <= 18 && h <= 18 && Math.abs(w - h) <= 4 && el.children.length == 0 && !hasText(el) && k2.c > .12)
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

			/* in a repainted card even half-transparent labels need our ink,
			   otherwise white-on-glass captions vanish on a light card */
			if (tc && (tc.a >= .95 || (card && tc.a >= .25)) && (card || !themed(tc))) {
				var k3 = hsl(tc);

				/* pale tints (lime, light yellow, sky) are highlights, not warnings */
				if (k3.c > .2 && tc.a >= .6)
					tags.push('t-' + (k3.l > .72 ? 'acc' : hue(tc)));
				else if (tc.a < .95 || (cs.textTransform == 'uppercase' && parseFloat(cs.fontSize) <= 13))
					tags.push('ink-dim');
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
		if ((tag == 'CANVAS' || tag == 'SVG') && w >= 40 && h >= 40 && inCard(el))
			tags.push('chart');

		if (tags.indexOf('surface') > -1 || tags.indexOf('note') > -1)
			cards.add(el);

		return tags.length ? tags.join(' ') : '';
	}

	/* ---------- mobile operator names ----------
	 * Apps that print the raw PLMN (MCC+MNC, e.g. "25002") next to an
	 * "operator" label get the brand name added: "МегаФон (25002)". */

	var RU = (root.lang || '').substr(0, 2) == 'ru';

	var PLMN = {
		'25001': [ 'МТС', 'MTS' ], '25002': [ 'МегаФон', 'MegaFon' ], '25099': [ 'Билайн', 'Beeline' ],
		'25028': [ 'Билайн', 'Beeline' ], '25020': [ 'T2', 'T2' ], '25011': [ 'Yota', 'Yota' ],
		'25062': [ 'Т-Мобайл', 'T-Mobile' ], '25035': [ 'Мотив', 'Motiv' ], '25039': [ 'Ростелеком', 'Rostelecom' ],
		'25027': [ 'Летай', 'Letai' ], '25032': [ 'Win mobile', 'Win mobile' ], '25034': [ 'Крымтелеком', 'Krymtelecom' ],
		'25060': [ 'Волна мобайл', 'Volna mobile' ], '25008': [ 'Вайнах Телеком', 'Vainah Telecom' ],
		'25701': [ 'A1', 'A1' ], '25702': [ 'МТС', 'MTS' ], '25704': [ 'life:)', 'life:)' ],
		'25501': [ 'Vodafone', 'Vodafone' ], '25503': [ 'Київстар', 'Kyivstar' ], '25506': [ 'lifecell', 'lifecell' ],
		'40101': [ 'Beeline', 'Beeline' ], '40102': [ 'Kcell', 'Kcell' ], '40107': [ 'Altel', 'Altel' ], '40177': [ 'Tele2', 'Tele2' ]
	};

	var OPSKIP = 'header.hud, .sidebar, footer, .n-saver, .n-ambient, .xd, script, style';

	var PLMN_RE = /^\s*(\d{3})[\s-]?(\d{2,3})\s*$/;
	var OPER_RE = /опера|operator|carrier|plmn|провайдер/i;

	function opfixText(t) {
		var m = PLMN_RE.exec(t.nodeValue || '');

		if (!m)
			return;

		var name = PLMN[m[1] + m[2]];
		var host = t.parentElement;

		if (!name || !host || host.closest(OPSKIP))
			return;

		/* the label sits in the same row: the parent or the one above it */
		var row = host.parentElement, ctx = (row ? row.textContent : '') || '';

		if (ctx.length > 300 || !OPER_RE.test(ctx)) {
			row = row && row.parentElement;
			ctx = row ? (row.textContent || '') : '';

			if (ctx.length > 400 || !OPER_RE.test(ctx))
				return;
		}

		t.nodeValue = name[RU ? 0 : 1] + ' (' + m[1] + m[2] + ')';
	}

	function opfix(node) {
		if (!node)
			return;

		if (node.nodeType == 3)
			return opfixText(node);

		if (node.nodeType != 1 || (node.closest && node.closest(OPSKIP)) || !/\d{5}/.test(node.textContent || ''))
			return;

		var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), t;

		while ((t = w.nextNode()) != null)
			if (/^\s*\d{3}[\s-]?\d{2,3}\s*$/.test(t.nodeValue))
				opfixText(t);
	}

	/* ---------- scanning ---------- */

	var seen = new WeakSet(),
	    sigs = new WeakMap();

	/* what an app can change that matters to us: its classes and the colour
	   part of its inline style (positions, sizes, opacity are ignored) */
	function signature(el) {
		var st = el.style || {};
		return (el.getAttribute('class') || '') + '|' + (st.background || '') + '|' + (st.backgroundColor || '') + '|' +
			(st.backgroundImage || '') + '|' + (st.color || '') + '|' + (st.borderColor || '') + '|' + (st.border || '');
	}

	/* outlines and glows an overlay app sets inline (even !important) */
	function stripInline() {
		var els = document.querySelectorAll('[data-nfx~="overlay"] [style*="text-shadow"], [data-nfx~="overlay"] [style*="stroke"], [data-nfx~="overlay"] [style*="filter"]');

		for (var i = 0; i < els.length; i++) {
			var st = els[i].style;
			st.removeProperty('text-shadow');
			st.removeProperty('-webkit-text-stroke');

			if (!/^(svg|canvas|img|circle|path)$/i.test(els[i].tagName) && /drop-shadow/.test(st.filter || ''))
				st.removeProperty('filter');
		}
	}

	var later = [], laterTimer = null;

	function isTransition(a) {
		return typeof CSSTransition == 'function' && a instanceof CSSTransition;
	}

	function scan(list, force) {
		buildPalette();

		var todo = [];

		/* read phase: no DOM writes in between, so one style recalc */
		for (var i = 0; i < list.length; i++) {
			var el = list[i];

			/* a tagged element shows our colours now; only a forced re-check
			   (which drops the tag first) may classify it again */
			if (!el.isConnected || (!force && (seen.has(el) || el.hasAttribute('data-nfx'))))
				continue;

			/* mid-transition colours are neither the app's nor ours: look again
			   once the transition has run */
			if (!force && el.getAnimations && el.getAnimations().some(isTransition)) {
				later.push(el);
				continue;
			}

			seen.add(el);
			sigs.set(el, signature(el));

			var t = classify(el);

			if (t !== null && t !== (el.getAttribute('data-nfx') || ''))
				todo.push([el, t]);
		}

		cards.clear();

		if (later.length && !laterTimer)
			laterTimer = window.setTimeout(function() {
				var l = later;
				later = [];
				laterTimer = null;
				scan(l, false);
			}, 450);

		/* write phase */
		for (var j = 0; j < todo.length; j++) {
			if (todo[j][1])
				todo[j][0].setAttribute('data-nfx', todo[j][1]);
			else
				todo[j][0].removeAttribute('data-nfx');

			if (todo[j][1] == 'overlay')
				document.dispatchEvent(new CustomEvent('404mode-overlay', { detail: todo[j][0] }));
		}

		stripInline();
	}

	/* re-check elements whose classes / colours changed. While their tag is
	   dropped and set again, transitions are held off (data-nfx-hold), so the
	   app's own colour never animates in for a frame — no blinking. */
	var held = [];

	function recheck(list) {
		list = list.filter(function(el, i, a) { return el.isConnected && a.indexOf(el) == i; });

		if (!list.length)
			return;

		list.forEach(function(el) {
			el.setAttribute('data-nfx-hold', '');
			el.removeAttribute('data-nfx');
		});

		scan(list, true);

		held.push.apply(held, list);

		window.requestAnimationFrame(function() {
			window.requestAnimationFrame(function() {
				var h = held;
				held = [];
				h.forEach(function(el) { el.removeAttribute('data-nfx-hold'); });
			});
		});
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

	/* mutations are handled in the observer callback itself, which runs before
	   the browser paints: new nodes never show up in the app's colours first */
	function onMutations(muts) {
		var added = [], changed = [];

		for (var i = 0; i < muts.length; i++) {
			var m = muts[i];

			if (m.type == 'characterData') {
				opfixText(m.target);
				continue;
			}

			if (m.type == 'childList') {
				opfix(m.target);

				for (var j = 0; j < m.addedNodes.length; j++)
					if (m.addedNodes[j].nodeType == 1)
						added.push(m.addedNodes[j]);
			}
			else if (m.target.nodeType == 1 && !m.target.closest(SKIP)) {
				var el = m.target;

				if (sigs.get(el) !== signature(el))
					changed.push(el);
			}
		}

		if (changed.length)
			recheck(changed);

		if (added.length) {
			var list = [];
			added.forEach(function(n) { if (n.isConnected) list.push.apply(list, all(n)); });
			scan(list, false);
		}
	}

	function start() {
		opfix(document.body);
		scan(all(scope()), false);

		/* modals, popups and overlays that apps append to <body> */
		Array.prototype.forEach.call(document.body.children, function(n) {
			if (n !== scope() && !n.matches('header, .shell, footer, script, style') && !n.contains(scope()))
				scan(all(n), false);
		});

		new MutationObserver(onMutations)
			.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });

		/* a scheme switch changes the palette: re-check every tagged element */
		document.addEventListener('404mode-scheme', function() {
			paletteKey = '';
			recheck(Array.prototype.slice.call(document.querySelectorAll('[data-nfx]')));
		});
	}

	if (document.readyState == 'loading')
		document.addEventListener('DOMContentLoaded', start);
	else
		start();

	/* late styles (fonts, app CSS loaded after the page) */
	/* look at the whole page again: untagged elements only (tagged ones keep
	   their tag and are re-checked when their class / style changes) */
	var rescanTimer = null;

	function rescanSoon(delay) {
		if (rescanTimer)
			window.clearTimeout(rescanTimer);

		rescanTimer = window.setTimeout(function() {
			rescanTimer = null;
			seen = new WeakSet();
			scan(all(scope()), false);
		}, delay || 80);
	}

	window.addEventListener('load', function() { rescanSoon(0); });

	/* LuCI views render after window.onload and often bring their own
	   stylesheet: nodes scanned before that CSS arrived looked unstyled, so
	   every late stylesheet load (and web fonts) triggers another pass */
	document.addEventListener('load', function(ev) {
		var t = ev.target;

		if (t && (t.tagName == 'LINK' || t.tagName == 'STYLE'))
			rescanSoon();
	}, true);

	if (document.fonts && document.fonts.addEventListener)
		document.fonts.addEventListener('loadingdone', function() { rescanSoon(); });

	/* inline <style> blocks added by scripts apply at once, but the nodes
	   they style may already have been scanned */
	new MutationObserver(function(muts) {
		for (var i = 0; i < muts.length; i++)
			for (var j = 0; j < muts[i].addedNodes.length; j++) {
				var n = muts[i].addedNodes[j];

				if (n.nodeType == 1 && (n.tagName == 'STYLE' || n.tagName == 'LINK'))
					return rescanSoon(n.tagName == 'STYLE' ? 0 : 400);
			}
	}).observe(document.documentElement, { childList: true, subtree: true });

	/* and a couple of passes for views that finish rendering late */
	[ 1500, 4000 ].forEach(function(ms) { window.setTimeout(function() { rescanSoon(0); }, ms); });
})();
