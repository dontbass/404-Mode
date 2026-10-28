#!/bin/sh
#
# 404 Mode — quick installer for OpenWrt 24.10+ (no SDK / no .ipk needed)
#
#   install (auto dark/light):  sh install.sh
#   force a variant:            sh install.sh --dark | --light
#   specific git ref:           sh install.sh v1.1.0 [--dark|--light]
#   uninstall:                  sh install.sh --remove
#

set -e

REPO="dontbass/404-Mode"
REF="main"
NAME="404mode"
VARIANT=""
ACTION="install"
WWW="/www/luci-static"
UCODE="/usr/share/ucode/luci/template/themes"

for arg in "$@"; do
	case "$arg" in
		--remove|-r) ACTION="remove" ;;
		--dark)      VARIANT="-dark" ;;
		--light)     VARIANT="-light" ;;
		-*)          echo "unknown option: $arg" >&2; exit 1 ;;
		*)           REF="$arg" ;;
	esac
done

say() { printf '\033[1;36m[404]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[404] %s\033[0m\n' "$*" >&2; exit 1; }

clear_cache() {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null || true
}

fetch() {
	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -q -O "$2" "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$2" "$1"
	elif command -v curl >/dev/null 2>&1; then
		curl -fsSL -o "$2" "$1"
	else
		die "no uclient-fetch / wget / curl found"
	fi
}

if [ "$ACTION" = "remove" ]; then
	say "removing theme"
	rm -rf "$WWW/$NAME" "$WWW/$NAME-dark" "$WWW/$NAME-light" \
	       "$WWW/resources/menu-$NAME.js" \
	       "$UCODE/$NAME" "$UCODE/$NAME-dark" "$UCODE/$NAME-light"
	uci -q delete luci.themes.404Mode || true
	uci -q delete luci.themes.404ModeDark || true
	uci -q delete luci.themes.404ModeLight || true
	case "$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/$NAME*) uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	clear_cache
	say "done — back to bootstrap"
	exit 0
fi

[ -d /usr/share/ucode/luci ] || die "ucode-based LuCI not found (need OpenWrt 24.10+)"

if opkg list-installed 2>/dev/null | grep -q '^luci-theme-404mode '; then
	die "luci-theme-404mode package is installed — update it with opkg instead"
fi

TMP="$(mktemp -d /tmp/404mode.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say "fetching $REPO@$REF"
fetch "https://codeload.github.com/$REPO/tar.gz/$REF" "$TMP/src.tgz" || die "download failed (check DNS / HTTPS / ref '$REF')"

tar -xzf "$TMP/src.tgz" -C "$TMP" || die "unpack failed"
SRC="$(find "$TMP" -maxdepth 2 -type d -name 'luci-theme-404mode' | head -n1)"
[ -n "$SRC" ] || die "package dir not found in archive"

say "installing files"
mkdir -p "$WWW/resources" "$UCODE"
rm -rf "$WWW/$NAME" "$WWW/$NAME-dark" "$WWW/$NAME-light" "$UCODE/$NAME" "$UCODE/$NAME-dark" "$UCODE/$NAME-light"
cp -R "$SRC/htdocs/luci-static/$NAME" "$WWW/"
cp "$SRC/htdocs/luci-static/resources/menu-$NAME.js" "$WWW/resources/"
cp -R "$SRC/ucode/template/themes/$NAME" "$UCODE/"

for v in dark light; do
	ln -sfn "$NAME" "$WWW/$NAME-$v"
	ln -sfn "$NAME" "$UCODE/$NAME-$v"
done

say "registering themes: 404Mode (auto), 404ModeDark, 404ModeLight"
uci set "luci.themes.404Mode=/luci-static/$NAME"
uci set "luci.themes.404ModeDark=/luci-static/$NAME-dark"
uci set "luci.themes.404ModeLight=/luci-static/$NAME-light"
uci set "luci.main.mediaurlbase=/luci-static/$NAME$VARIANT"
uci commit luci
clear_cache

say "active: /luci-static/$NAME$VARIANT — reload LuCI (Ctrl+F5)"
say "switch later: System → System → Language and Style"
