#
# luci-theme-404mode — cyberpunk / digital-noir theme for LuCI (OpenWrt 24.10+)
# https://github.com/dontbass/404-Mode
#
# Licensed under the Apache License, Version 2.0.
# Component base derived from luci-theme-bootstrap (Apache-2.0, The LuCI Team).
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=404 Mode — cyberpunk theme
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Vladimir <dontbass@users.noreply.github.com>

# csstidy breaks modern CSS (custom properties in shorthands, @supports, clamp())
LUCI_MINIFY_CSS:=0

define Package/luci-theme-404mode/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.404Mode
	if [ "$$(uci -q get luci.main.mediaurlbase)" = "/luci-static/404mode" ]; then
		uci -q set luci.main.mediaurlbase=/luci-static/bootstrap
	fi
	uci commit luci
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
