#
# luci-theme-404mode — cyberpunk / digital-noir theme for LuCI (OpenWrt 24.10+)
# https://github.com/dontbass/404-Mode
#
# Licensed under the Apache License, Version 2.0.
# Component base derived from luci-theme-bootstrap (Apache-2.0, The LuCI Team).
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=404 Mode — neon router console theme (dark, light, ГОСТ-24)
LUCI_DEPENDS:=+luci-base +rpcd-mod-ucode +ucode-mod-fs
LUCI_PKGARCH:=all

PKG_VERSION:=1.9.2
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Vladimir <dontbass@users.noreply.github.com>

# csstidy breaks modern CSS (custom properties in shorthands, @supports, clamp())
LUCI_MINIFY_CSS:=0

define Package/luci-theme-404mode/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.404Mode
	uci -q delete luci.themes.404ModeDark
	uci -q delete luci.themes.404ModeLight
	uci -q delete luci.themes.404ModeGost
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/404mode*) uci -q set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
