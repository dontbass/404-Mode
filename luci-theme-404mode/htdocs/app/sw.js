/* 404 Mode — phone app service worker: the app shell works offline,
   the status itself always comes from the router. */
'use strict';

const CACHE = '404mode-app-2';
const SHELL = [
	'./', 'index.html', 'app.css?v=2', 'app.js?v=2', 'manifest.webmanifest',
	'icons/icon-192.png', 'icons/icon-512.png',
	'/luci-static/404mode/neon/fonts/onest-cyrillic-wght-normal.woff2',
	'/luci-static/404mode/neon/fonts/onest-latin-wght-normal.woff2',
	'/luci-static/404mode/neon/fonts/unbounded-cyrillic-wght-normal.woff2',
	'/luci-static/404mode/neon/fonts/unbounded-latin-wght-normal.woff2',
	'/luci-static/404mode/neon/fonts/jetbrains-mono-latin-wght-normal.woff2'
];

self.addEventListener('install', ev => {
	ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
	ev.waitUntil(caches.keys()
		.then(keys => Promise.all(keys.filter(k => k.startsWith('404mode-app-') && k !== CACHE).map(k => caches.delete(k))))
		.then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
	const url = new URL(ev.request.url);
	if (ev.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/cgi-bin/'))
		return;

	/* the shell: network first so updates land, cache when the router is away */
	ev.respondWith(fetch(ev.request).then(r => {
		if (r.ok) {
			const copy = r.clone();
			caches.open(CACHE).then(c => c.put(ev.request, copy));
		}
		return r;
	}).catch(() => caches.match(ev.request, { ignoreSearch: false })
		.then(hit => hit || (ev.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
