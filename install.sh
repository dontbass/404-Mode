#!/bin/sh
#
# 404 Mode — quick installer for OpenWrt 24.10 (no SDK / no .ipk needed)
#
#   install:    sh -c "$(uclient-fetch -qO- https://raw.githubusercontent.com/dontbass/404-Mode/main/install.sh)"
#   specific:   sh install.sh v1.0.0
#   uninstall:  sh install.sh --remove
#

set -e

REPO="dontbass/404-Mode"
REF="${1:-main}"
NAME="404mode"
UCI_KEY="404Mode"
MEDIA="/luci-static/$NAME"
WWW="/www/luci-static"
UCODE="/usr/share/ucode/luci/template/themes"

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

if [ "$1" = "--remove" ] || [ "$1" = "-r" ]; then
	say "removing theme"
	rm -rf "$WWW/$NAME" "$WWW/resources/menu-$NAME.js" "$UCODE/$NAME"
	uci -q delete "luci.themes.$UCI_KEY" || true
	if [ "$(uci -q get luci.main.mediaurlbase)" = "$MEDIA" ]; then
		uci set luci.main.mediaurlbase=/luci-static/bootstrap
	fi
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
mkdir -p "$WWW" "$UCODE"
rm -rf "$WWW/$NAME" "$UCODE/$NAME"
cp -R "$SRC/htdocs/luci-static/." "$WWW/"
cp -R "$SRC/ucode/template/themes/$NAME" "$UCODE/"

say "registering theme"
uci set "luci.themes.$UCI_KEY=$MEDIA"
uci set "luci.main.mediaurlbase=$MEDIA"
uci commit luci
clear_cache

say "done. reload LuCI (Ctrl+F5). Remove: sh install.sh --remove"
