#
# luci-theme-404mode-modemwebui — 404 Mode skin for Modem WebUI (luci-app-modemwebui, :8001)
# https://github.com/dontbass/404-Mode
#
# Licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-404mode-modemwebui
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Vladimir <dontbass@users.noreply.github.com>

include $(INCLUDE_DIR)/package.mk

define Package/luci-theme-404mode-modemwebui
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=4. Themes
  TITLE:=404 Mode skin for Modem WebUI (port 8001)
  DEPENDS:=+luci-theme-404mode
  PKGARCH:=all
endef

define Package/luci-theme-404mode-modemwebui/description
  Restyles the Modem WebUI panel (luci-app-modemwebui, Ant Design Pro on :8001)
  to follow the active 404 Mode variant (ГОСТ-24 / ASH / SAMIZDAT, dark or light).
  Adds two marked tags to the panel's index.html files; removal is byte-exact.
endef

define Build/Compile
endef

define Package/luci-theme-404mode-modemwebui/install
	$(INSTALL_DIR) $(1)/usr/share/404mode/modemwebui
	$(INSTALL_DATA) ./files/404mode/modem.css $(1)/usr/share/404mode/modemwebui/
	$(INSTALL_DATA) ./files/404mode/modem.js $(1)/usr/share/404mode/modemwebui/
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/404mode-modemwebui $(1)/usr/libexec/404mode-modemwebui
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/404mode-modemwebui.init $(1)/etc/init.d/404mode-modemwebui
endef

define Package/luci-theme-404mode-modemwebui/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/404mode-modemwebui enable
/usr/libexec/404mode-modemwebui apply
exit 0
endef

define Package/luci-theme-404mode-modemwebui/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/404mode-modemwebui disable
/usr/libexec/404mode-modemwebui remove
exit 0
endef

$(eval $(call BuildPackage,luci-theme-404mode-modemwebui))
