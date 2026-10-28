# 404 MODE

**Киберпанк / пост-апокалипсис тема для LuCI (OpenWrt 24.10+).** Неон поверх пепла, колючая проволока, гранж и ощущение, что интернет больше не свободный.

`СИГНАЛ ПОТЕРЯН // СЕТЬ НЕСВОБОДНА — ПОДТВЕРДИТЕ ЛИЧНОСТЬ`

| ASH (тёмная) | SAMIZDAT (светлая) |
|---|---|
| ![Dark](docs/dark-overview.jpg) | ![Light](docs/light-overview.jpg) |
| ![Dark settings](docs/dark-settings.jpg) | ![Light settings](docs/light-settings.jpg) |
| ![Dark login](docs/dark-login.jpg) | ![Light login](docs/light-login.jpg) |

![Mobile](docs/mobile.jpg)

## Две темы в одном пакете

| В LuCI | Путь | Поведение |
|---|---|---|
| **404Mode** | `/luci-static/404mode` | авто по системной теме браузера + переключатель `AUTO / DARK / LITE` в шапке |
| **404ModeDark** | `/luci-static/404mode-dark` | всегда **ASH** — сажа, токсичный неон, ржавчина, CRT-сканлайны |
| **404ModeLight** | `/luci-static/404mode-light` | всегда **SAMIZDAT** — ксерокопия на старой бумаге, типографская краска, красный штамп |

Выбор: **System → System → Language and Style**.

## Атмосфера

- **Лента цензуры** под шапкой — «ТРАФИК ДОСМАТРИВАЕТСЯ (DPI)», «РЕСУРС ЗАБЛОКИРОВАН ПО ТРЕБОВАНИЮ ████», «ТУННЕЛЬ — ЕДИНСТВЕННЫЙ ВЫХОД». Пауза при наведении. Русский/английский по языку LuCI.
- **Колючая проволока** по краю шапки, **сигнальные ленты** на панели действий и предупреждениях.
- **Цензурные плашки** `████` (`.redact`) — в ленте и в футере `NET//CENSORED`.
- **Скотч** на углах панелей, **плёночное зерно**, пятна ржавчины на фоне, **мигающая неоновая вывеска** `404`.
- **Аплинк: ФИЛЬТРУЕТСЯ** — мигающий индикатор внизу сайдбара.
- **Экран входа**: цифровой дождь с «мёртвыми» колонками, штамп «ДОСТУП ОГРАНИЧЕН», «СЕАНС ЗАПИСЫВАЕТСЯ».
- **FX** в шапке выключает зерно, сканлайны, ленту, глитч и анимации (для слабых устройств). `prefers-reduced-motion` учитывается автоматически.

## Функционал

- Шаблоны на **ucode** (`header.ut` / `footer.ut` / `sysauth.ut`) — нативно для LuCI 24.10.
- Сайдбар с hex-индексами (`0x01 STATUS`…), аккордеон, мини-режим, drawer на телефоне.
- Все компоненты LuCI перекрашены: таблицы, дропдауны, dynlist, вкладки, модалки, прогресс-бары, алерты, бейджи зон.
- Без внешних шрифтов и CDN — работает на роутере без интернета.

## Установка

### Быстро (без сборки)

```sh
uclient-fetch -qO /tmp/404.sh https://raw.githubusercontent.com/dontbass/404-Mode/main/install.sh
sh /tmp/404.sh            # авто
sh /tmp/404.sh --dark     # сразу тёмная
sh /tmp/404.sh --light    # сразу светлая
sh /tmp/404.sh --remove   # удалить, вернуть bootstrap
```

### Пакетом (.ipk)

`luci-theme-404mode_*_all.ipk` собирает GitHub Actions — забрать в **Releases** (теги `v*`) или в артефактах workflow.

```sh
opkg install /tmp/luci-theme-404mode_*_all.ipk
```

### Своя сборка

```sh
git clone https://github.com/dontbass/404-Mode.git package/404-Mode
make menuconfig   # LuCI → Themes → luci-theme-404mode
make package/404-Mode/luci-theme-404mode/compile V=s
```

## Структура

```
luci-theme-404mode/
├── Makefile
├── htdocs/luci-static/
│   ├── 404mode/
│   │   ├── cascade.css          # база компонентов + слой 404 MODE (токены ASH / SAMIZDAT)
│   │   ├── mobile.css
│   │   └── logo.svg, logo_48.png
│   ├── 404mode-dark  -> 404mode
│   ├── 404mode-light -> 404mode
│   └── resources/menu-404mode.js
├── ucode/template/themes/
│   ├── 404mode/{header,footer,sysauth}.ut
│   ├── 404mode-dark  -> 404mode
│   └── 404mode-light -> 404mode
└── root/etc/uci-defaults/30_luci-theme-404mode
```

## Палитра

| Токен | ASH | SAMIZDAT | Где |
|---|---|---|---|
| `--n-cyan` | `#00e8f0` | `#00727c` | акцент, ссылки, рамки |
| `--n-magenta` | `#ff2a6d` | `#c4122f` | активное, ошибки, штамп |
| `--n-green` | `#39ff9c` | `#1d7a3e` | сохранить / применить |
| `--n-yellow` | `#f2d60b` | `#e5b100` | сигнальные ленты, предупреждения |
| `--n-rust` | `#d9622b` | `#a8471c` | ржавчина, «фильтруется» |
| `--n-bg` | `#0b0b0a` | `#e9e4d8` | фон |

Перекрасить — поменять токены в блоках `ASH` / `SAMIZDAT` в `cascade.css`.

## Лицензия

Apache-2.0. Базовые стили компонентов основаны на `luci-theme-bootstrap` (The LuCI Team, Apache-2.0).
