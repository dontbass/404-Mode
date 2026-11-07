'use strict';
'require view';
'require rpc';
'require ui';
'require neon-404mode as x';

/*
 * 404 Mode — System › Phone app: the QR code that opens the phone app
 * (PWA at /app/) with its access key, the HTTPS state and key rotation.
 * https://github.com/dontbass/404-Mode — Apache-2.0
 */

const callApp = rpc.declare({ object: '404mode', method: 'app', expect: { '': {} } });
const callAppSet = rpc.declare({ object: '404mode', method: 'app_set', params: [ 'action' ], expect: { '': {} } });

const T = (ru, en) => x.t(ru, en);

function loadQr() {
	if (window.qrcode)
		return Promise.resolve(window.qrcode);
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = L.resource('404mode-qr.js') + '?v=1';
		s.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('qr'));
		s.onerror = reject;
		document.head.appendChild(s);
	});
}

/* the QR as an SVG with square modules, readable from a phone screen */
function qrSvg(qrcode, text) {
	const qr = qrcode(0, 'M');
	qr.addData(text, 'Byte');
	qr.make();
	const n = qr.getModuleCount(), q = 4, size = n + q * 2;
	let d = '';
	for (let r = 0; r < n; r++)
		for (let c = 0; c < n; c++)
			if (qr.isDark(r, c))
				d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
	return '<svg viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR">' +
		'<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#0A0F17"/></svg>';
}

return view.extend({
	load() {
		x.css();
		return Promise.all([ L.resolveDefault(callApp(), {}), L.resolveDefault(loadQr(), null) ]);
	},

	render([ info, qrcode ]) {
		this.qrcode = qrcode;
		this.root = E('div', { 'class': 'xd xa' }, [
			E('div', { 'class': 'xm-head' }, [
				E('div', {}, [
					E('h2', { 'name': 'content' }, [ T('Приложение на телефон', 'Phone app') ]),
					E('div', { 'class': 'xm-sub' }, [ T('Интернет, прокси и сотовая связь роутера на экране телефона', 'Internet, proxy and cellular status on your phone') ])
				])
			]),
			E('div', { 'class': 'xd-grid' }, [
				E('section', { 'class': 'xd-card xa-qr-card' }, [
					E('div', { 'class': 'xa-qr', 'id': 'xa-qr' }),
					E('div', { 'class': 'xa-qr-text' }, [
						E('h3', {}, [ T('Наведите камеру телефона', 'Point your phone camera') ]),
						E('ol', { 'class': 'xa-steps' }, [
							E('li', {}, [ T('Телефон должен быть в Wi-Fi этого роутера.', 'The phone must be on this router\'s Wi-Fi.') ]),
							E('li', {}, [ T('Отсканируйте QR-код, откроется приложение.', 'Scan the QR code, the app opens.') ]),
							E('li', {}, [ T('В меню Chrome выберите «Установить приложение» или «Добавить на главный экран».', 'In the Chrome menu pick Install app or Add to Home screen.') ])
						]),
						E('div', { 'class': 'xa-link' }, [ E('code', { 'id': 'xa-url' }), E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': () => this.copy() }, [ T('Копировать', 'Copy') ]) ]),
						E('small', { 'class': 'xm-note', 'id': 'xa-mode' })
					])
				]),
				E('section', { 'class': 'xd-card xa-widget' }, [
					E('div', { 'class': 'xd-card-head' }, [ E('div', {}, [
						E('h3', {}, [ T('Android-виджет', 'Android widget') ]),
						E('div', { 'class': 'xd-muted' }, [ T('Интернет, нода прокси и сигнал LTE прямо на рабочем столе. Работает по IP роутера, домен и сертификат ему не нужны.', 'Internet, proxy node and LTE signal on the home screen. Talks to the router by IP, no domain or certificate needed.') ])
					]) ]),
					E('ol', { 'class': 'xa-steps' }, [
						E('li', {}, [ T('Скачайте на телефон и установите ', 'Download to the phone and install '), E('a', { 'href': 'https://github.com/dontbass/404-Mode/releases/tag/android-widget', 'target': '_blank', 'rel': 'noopener' }, [ '404mode-widget.apk' ]), '.' ]),
						E('li', {}, [ T('Откройте приложение роутера по QR-коду выше и нажмите «Настроить Android-виджет»: адрес и ключ подставятся сами.', 'Open the router app from the QR code above and tap Set up Android widget: address and key fill in by themselves.') ]),
						E('li', {}, [ T('Или введите в приложении адрес ', 'Or type the address '), E('code', {}, [ info.lan || location.hostname ]), T(' и ключ доступа.', ' and the access key.') ])
					])
				]),
				E('section', { 'class': 'xd-card xa-https' }, [
					E('div', { 'class': 'xd-card-head' }, [ E('div', {}, [ E('h3', {}, [ 'HTTPS' ]), E('div', { 'class': 'xd-muted', 'id': 'xa-https-state' }) ]) ]),
					E('p', { 'class': 'xa-p' }, [ T('Установить сайт как приложение Chrome даёт только по HTTPS. Сертификат Let\'s Encrypt выпускается на роутере через DNS вашего домена: открывать роутер в интернет и арендовать сервер не нужно. Выполните в SSH:', 'Chrome installs a site as an app only over HTTPS. The router gets a Let\'s Encrypt certificate through your domain\'s DNS: no open ports, no server. Run over SSH:') ]),
					E('pre', { 'class': 'xa-pre' }, [ '404mode-https router.example.ru dns_cf CF_Token=…' ]),
					E('small', { 'class': 'xm-note' }, [ T('dns_cf — Cloudflare. Другие провайдеры DNS: dns_regru (REGRU_API_Username, REGRU_API_Password), dns_selectel, dns_yandex360 и ещё 150 — список в acme.sh/wiki/dnsapi. Сертификат продлевается сам; имя домена роутер отдаёт телефонам сам, без интернета.', 'dns_cf is Cloudflare. Other DNS providers: dns_regru, dns_selectel, dns_yandex360 and 150 more, see acme.sh/wiki/dnsapi. The certificate renews itself; the router answers the name to phones on its own, even offline.') ])
				]),
				E('section', { 'class': 'xd-card xa-key' }, [
					E('div', { 'class': 'xd-card-head' }, [ E('div', {}, [
						E('h3', {}, [ T('Ключ доступа', 'Access key') ]),
						E('div', { 'class': 'xd-muted' }, [ T('Приложение и виджет читают состояние роутера по этому ключу. Только чтение: изменить настройки с ним нельзя.', 'The app and the widget read the router status with this key. Read only: it cannot change settings.') ])
					]) ]),
					E('code', { 'class': 'xa-token', 'id': 'xa-token' }),
					E('div', { 'class': 'xm-actions' }, [
						E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': ev => this.test(ev.currentTarget) }, [ T('Проверить ответ', 'Test the answer') ]),
						E('span', { 'class': 'xm-dirty', 'id': 'xa-test' }),
						E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-negative', 'click': ev => this.rotate(ev.currentTarget) }, [ T('Сменить ключ', 'New key') ])
					])
				])
			])
		]);

		this.paint(info);
		return this.root;
	},

	url(info) {
		const host = info.domain || info.lan || location.hostname;
		return (info.domain ? 'https://' : 'http://') + host + '/app/#t=' + (info.token || '');
	},

	paint(info) {
		this.info = info;
		const q = id => this.root.querySelector('#' + id);
		const url = this.url(info);

		q('xa-url').textContent = url;
		q('xa-token').textContent = info.token || '—';
		q('xa-qr').innerHTML = this.qrcode && info.token ? qrSvg(this.qrcode, url) : '';
		q('xa-mode').textContent = info.domain
			? T('Приложение откроется по HTTPS и установится на главный экран.', 'The app opens over HTTPS and installs to the home screen.')
			: T('Пока без HTTPS: откроется как вкладка браузера, ярлык на экран добавить можно, установки и офлайн-режима не будет.', 'No HTTPS yet: it opens as a browser tab; a home screen shortcut works, install and offline do not.');
		q('xa-https-state').textContent = info.domain
			? info.domain + (info.expires ? T(' · сертификат до ', ' · certificate until ') + new Date(info.expires).toLocaleDateString(x.RU ? 'ru-RU' : 'en-US') : '')
			: T('Не настроен', 'Not set up');
	},

	copy() {
		const url = this.url(this.info);
		(navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
			.then(() => x.toast(T('Ссылка скопирована', 'Link copied'), 'ok'))
			.catch(() => x.toast(url, 'info', null, 12000));
	},

	test(btn) {
		btn.disabled = true;
		const out = this.root.querySelector('#xa-test');
		out.textContent = T('Спрашиваем роутер…', 'Asking the router…');
		const t0 = Date.now();
		fetch('/cgi-bin/404status', { headers: { 'Authorization': 'Bearer ' + this.info.token }, cache: 'no-store' })
			.then(r => r.json())
			.then(d => {
				if (d.error) throw new Error(d.error);
				out.style.color = 'var(--xd-ok)';
				out.textContent = T('Отвечает за ', 'Answers in ') + (Date.now() - t0) + T(' мс: ', ' ms: ') +
					[ d.net && d.net.online ? T('интернет есть', 'online') : T('нет интернета', 'offline'),
					  d.proxy && d.proxy.node, d.cell && d.cell.combo ].filter(Boolean).join(', ');
			})
			.catch(e => {
				out.style.color = 'var(--xd-bad)';
				out.textContent = T('Нет ответа: ', 'No answer: ') + e.message;
			})
			.finally(() => { btn.disabled = false; });
	},

	rotate(btn) {
		if (!btn.classList.contains('xm-confirm')) {
			btn.classList.add('xm-confirm');
			btn.textContent = T('Телефоны отключатся. Сменить?', 'Phones lose access. Change?');
			window.setTimeout(() => { btn.classList.remove('xm-confirm'); btn.textContent = T('Сменить ключ', 'New key'); }, 4000);
			return;
		}
		btn.classList.remove('xm-confirm');
		btn.textContent = T('Сменить ключ', 'New key');
		L.resolveDefault(callAppSet('rotate'), null).then(info => {
			if (!info || !info.token)
				return x.toast(T('Не получилось сменить ключ', 'Could not change the key'), 'bad');
			this.paint(info);
			x.toast(T('Новый ключ. Отсканируйте QR-код на телефонах заново.', 'New key. Scan the QR code on your phones again.'), 'ok');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
