#!/bin/sh
#
# 404 Mode — quick installer for OpenWrt 24.10+ (no SDK / no .ipk needed)
#
#   install (auto dark/light):  sh install.sh
#   force a variant:            sh install.sh --dark | --light | --gost
#   specific git ref:           sh install.sh v1.2.0 [--dark|--light|--gost]
#   offline (zip from a PC):    sh install.sh --local /tmp/404-Mode-main.zip [--gost]
#   uninstall:                  sh install.sh --remove
#
# If Modem WebUI (luci-app-modemwebui, :8001) is present, its skin hook is
# installed too, so the modem panel follows the theme (dark/light, ГОСТ-24).
#

set -e

REPO="dontbass/404-Mode"
REF="main"
NAME="404mode"
VARIANT=""
ACTION="install"
LOCAL=""
WWW="/www/luci-static"
UCODE="/usr/share/ucode/luci/template/themes"

for arg in "$@"; do
	case "$arg" in
		--remove|-r) ACTION="remove" ;;
		--dark)      VARIANT="-dark" ;;
		--light)     VARIANT="-light" ;;
		--gost)      VARIANT="-gost" ;;
		--local)     LOCAL="__next__" ;;
		-*)          echo "unknown option: $arg" >&2; exit 1 ;;
		*)           if [ "$LOCAL" = "__next__" ]; then LOCAL="$arg"; else REF="$arg"; fi ;;
	esac
done

say() { printf '\033[1;36m[404]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[404] %s\033[0m\n' "$*" >&2; exit 1; }

RPCD="/usr/share/rpcd"
LIBEXEC="/usr/libexec"

reload_rpcd() {
	/etc/init.d/rpcd reload >/dev/null 2>&1 || killall -HUP rpcd 2>/dev/null || true
}

clear_cache() {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null || true
}

FETCH_LOG="/tmp/404mode-fetch.log"

# fetch URL FILE — quiet on success, the reason goes to $FETCH_LOG on failure
fetch() {
	rm -f "$2"
	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -T 20 -O "$2" "$1" >>"$FETCH_LOG" 2>&1
	elif command -v curl >/dev/null 2>&1; then
		curl -fsSL --connect-timeout 20 -o "$2" "$1" >>"$FETCH_LOG" 2>&1
	elif command -v wget >/dev/null 2>&1; then
		wget -T 20 -O "$2" "$1" >>"$FETCH_LOG" 2>&1
	else
		die "no uclient-fetch / curl / wget found"
	fi
	[ -s "$2" ]
}

# get the package sources into $TMP, trying several routes:
#   1. GitHub tarball (codeload / github.com archive)
#   2. file by file from MANIFEST via raw.githubusercontent.com or jsDelivr
#      (one of them usually works when the others are blocked)
get_sources() {
	local url host base f n

	for url in "https://codeload.github.com/$REPO/tar.gz/$REF" \
	           "https://github.com/$REPO/archive/$REF.tar.gz"; do
		host="${url#https://}"; host="${host%%/*}"
		say "download: $host"
		if fetch "$url" "$TMP/src.tgz" && tar -xzf "$TMP/src.tgz" -C "$TMP" 2>>"$FETCH_LOG"; then
			SRC="$(find "$TMP" -maxdepth 2 -type d -name 'luci-theme-404mode' | head -n1)"
			[ -n "$SRC" ] && return 0
		fi
		say "  $host: unavailable"
	done

	for base in "https://raw.githubusercontent.com/$REPO/$REF" \
	            "https://cdn.jsdelivr.net/gh/$REPO@$REF" \
	            "https://fastly.jsdelivr.net/gh/$REPO@$REF"; do
		host="${base#https://}"; host="${host%%/*}"
		say "download: $host (file by file)"
		rm -rf "$TMP/cdn"; mkdir -p "$TMP/cdn"; n=0
		if fetch "$base/MANIFEST" "$TMP/MANIFEST"; then
			while read -r f; do
				case "$f" in ''|\#*) continue ;; esac
				mkdir -p "$TMP/cdn/$(dirname "$f")"
				fetch "$base/$f" "$TMP/cdn/$f" || { n=-1; break; }
				n=$((n + 1))
			done < "$TMP/MANIFEST"
			if [ "$n" -gt 0 ]; then
				say "  $n files"
				SRC="$TMP/cdn/luci-theme-404mode"
				return 0
			fi
		fi
		say "  $host: unavailable"
	done

	return 1
}

net_help() {
	printf '\033[1;31m[404] download failed on every route.\033[0m\n' >&2
	echo "  last errors:" >&2
	tail -n 6 "$FETCH_LOG" 2>/dev/null | sed 's/^/    /' >&2
	cat >&2 <<-'HELP'
	  check on the router:
	    nslookup codeload.github.com      # DNS
	    nslookup raw.githubusercontent.com
	    nslookup cdn.jsdelivr.net
	    opkg list-installed | grep -E 'ustream|ca-bundle|ca-certificates'   # HTTPS support
	  or download the repo zip on a PC, copy it to /tmp and run:
	    sh install.sh --local /tmp/404-Mode-main.zip   (or the unpacked folder)
	HELP
	exit 1
}

if [ "$ACTION" = "remove" ]; then
	say "removing theme"
	if [ -x /usr/libexec/404mode-modemwebui ]; then
		/usr/libexec/404mode-modemwebui remove || true
		/etc/init.d/404mode-modemwebui disable 2>/dev/null || true
		rm -f /usr/libexec/404mode-modemwebui /etc/init.d/404mode-modemwebui
		rm -rf /usr/share/404mode
	fi
	rm -rf "$WWW/$NAME" "$WWW/$NAME-dark" "$WWW/$NAME-light" "$WWW/$NAME-gost" \
	       "$WWW/resources/menu-$NAME.js" "$WWW/resources/hud-$NAME.js" "$WWW/resources/nfx-$NAME.js" \
	       "$WWW/resources/brief-$NAME.js" "$RPCD/ucode/$NAME.uc" "$RPCD/acl.d/luci-theme-$NAME.json" "$LIBEXEC/$NAME-brief" /tmp/404mode-brief \
	       "$UCODE/$NAME" "$UCODE/$NAME-dark" "$UCODE/$NAME-light" "$UCODE/$NAME-gost" \
	       /www/app /www/cgi-bin/404status "$WWW/resources/$NAME-qr.js" /tmp/404mode-status
	# HTTPS (404mode-https) and the app key in /etc/404mode stay: run
	# "404mode-https --remove" first to undo the certificate as well
	reload_rpcd
	# the TTL rule set from the modem page goes with the theme
	if [ -f /etc/nftables.d/90-404mode-ttl.nft ]; then
		rm -f /etc/nftables.d/90-404mode-ttl.nft
		fw4 -q reload >/dev/null 2>&1 || true
	fi
	uci -q delete luci.themes.404Mode || true
	uci -q delete luci.themes.404ModeDark || true
	uci -q delete luci.themes.404ModeLight || true
	uci -q delete luci.themes.404ModeGost || true
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

: > "$FETCH_LOG"

if [ -n "$LOCAL" ] && [ "$LOCAL" != "__next__" ]; then
	say "using local sources: $LOCAL"
	if [ -d "$LOCAL" ]; then
		cp -R "$LOCAL" "$TMP/local"
	else
		case "$LOCAL" in
			*.zip) unzip -q "$LOCAL" -d "$TMP/local" || die "unzip failed (opkg install unzip)" ;;
			*)     mkdir -p "$TMP/local"; tar -xzf "$LOCAL" -C "$TMP/local" || die "unpack failed" ;;
		esac
	fi
	SRC="$(find "$TMP/local" -maxdepth 3 -type d -name 'luci-theme-404mode' | head -n1)"
	[ -n "$SRC" ] || die "luci-theme-404mode not found in $LOCAL"
else
	say "fetching $REPO@$REF"
	get_sources || net_help
fi

say "installing files"
mkdir -p "$WWW/resources" "$UCODE"
rm -rf "$WWW/$NAME" "$WWW/$NAME-dark" "$WWW/$NAME-light" "$WWW/$NAME-gost" "$UCODE/$NAME" "$UCODE/$NAME-dark" "$UCODE/$NAME-light" "$UCODE/$NAME-gost"
cp -R "$SRC/htdocs/luci-static/$NAME" "$WWW/"
cp "$SRC/htdocs/luci-static/resources/menu-$NAME.js" "$SRC/htdocs/luci-static/resources/hud-$NAME.js" \
   "$SRC/htdocs/luci-static/resources/nfx-$NAME.js" "$SRC/htdocs/luci-static/resources/brief-$NAME.js" "$WWW/resources/"

# dashboard ("Overview") and the Nikki / mihomo proxy panel
if [ -d "$SRC/htdocs/luci-static/resources/view/$NAME" ]; then
	cp "$SRC/htdocs/luci-static/resources/neon-$NAME.js" "$WWW/resources/"
	rm -rf "$WWW/resources/view/$NAME"
	mkdir -p "$WWW/resources/view"
	cp -R "$SRC/htdocs/luci-static/resources/view/$NAME" "$WWW/resources/view/"
	mkdir -p "$WWW/resources/$NAME-op"	# your operator logos (<PLMN>.png), kept on updates
	mkdir -p /usr/share/luci/menu.d
	cp "$SRC/root/usr/share/luci/menu.d/luci-theme-$NAME.json" /usr/share/luci/menu.d/
	rm -f /tmp/404mode-mihomo.json
fi

# phone app (PWA at /app/), its status endpoint and the HTTPS helper
if [ -d "$SRC/htdocs/app" ]; then
	rm -rf /www/app
	cp -R "$SRC/htdocs/app" /www/app
	[ -f "$SRC/htdocs/luci-static/resources/$NAME-qr.js" ] && cp "$SRC/htdocs/luci-static/resources/$NAME-qr.js" "$WWW/resources/"
	mkdir -p /www/cgi-bin /usr/sbin
	cp "$SRC/root/www/cgi-bin/404status" /www/cgi-bin/404status
	cp "$SRC/root/usr/sbin/$NAME-https" "/usr/sbin/$NAME-https"
	chmod +x /www/cgi-bin/404status "/usr/sbin/$NAME-https"
	rm -rf /tmp/404mode-status
fi
cp -R "$SRC/ucode/template/themes/$NAME" "$UCODE/"

# header brief backend (weather / rates / headlines): rpcd ucode plugin + ACL
if [ -d "$SRC/root/usr/share/rpcd" ]; then
	mkdir -p "$RPCD/ucode" "$RPCD/acl.d"
	cp "$SRC/root/usr/share/rpcd/ucode/$NAME.uc" "$RPCD/ucode/"
	cp "$SRC/root/usr/share/rpcd/acl.d/luci-theme-$NAME.json" "$RPCD/acl.d/"
	mkdir -p "$LIBEXEC"
	cp "$SRC/root/usr/libexec/$NAME-brief" "$LIBEXEC/"
	chmod +x "$LIBEXEC/$NAME-brief"
	reload_rpcd
fi

for v in dark light gost; do
	ln -sfn "$NAME" "$WWW/$NAME-$v"
	ln -sfn "$NAME" "$UCODE/$NAME-$v"
done

say "registering themes: 404Mode (auto), 404ModeDark, 404ModeLight, 404ModeGost"
uci set "luci.themes.404Mode=/luci-static/$NAME"
uci set "luci.themes.404ModeDark=/luci-static/$NAME-dark"
uci set "luci.themes.404ModeLight=/luci-static/$NAME-light"
uci set "luci.themes.404ModeGost=/luci-static/$NAME-gost"
uci set "luci.main.mediaurlbase=/luci-static/$NAME$VARIANT"
uci commit luci
clear_cache

# Modem WebUI skin hook
MW="$(find "$TMP" -maxdepth 4 -type d -name 'luci-theme-404mode-modemwebui' | head -n1)"
if [ -d /www/webui ] && [ -n "$MW" ] && ! opkg list-installed 2>/dev/null | grep -q '^luci-theme-404mode-modemwebui '; then
	say "Modem WebUI found — hooking the modem panel"
	mkdir -p /usr/share/404mode/modemwebui /usr/libexec /etc/init.d
	cp "$MW/files/404mode/modem.css" "$MW/files/404mode/modem.js" /usr/share/404mode/modemwebui/
	cp "$MW/files/404mode-modemwebui" /usr/libexec/404mode-modemwebui
	cp "$MW/files/404mode-modemwebui.init" /etc/init.d/404mode-modemwebui
	chmod +x /usr/libexec/404mode-modemwebui /etc/init.d/404mode-modemwebui
	/etc/init.d/404mode-modemwebui enable 2>/dev/null || true
	/usr/libexec/404mode-modemwebui apply || true
fi

say "active: /luci-static/$NAME$VARIANT — reload LuCI (Ctrl+F5)"
say "switch later: System → System → Language and Style"
