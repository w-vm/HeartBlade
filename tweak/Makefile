TARGET := iphone:clang:latest:14.0
ARCHS = arm64
INSTALL_TARGET_PROCESSES = Discord
THEOS_PACKAGE_SCHEME = rootless
FINALPACKAGE = 1

# Where the JS client bundle is published. Change to your own repo.
HB_BUNDLE_URL ?= https://github.com/w-vm/heartblade/releases/download/latest/heartblade.js

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = Heartblade

Heartblade_FILES = Sources/Tweak.xm Sources/Store.m Sources/Panel.m Headers/jsi/jsi.cpp
Heartblade_CFLAGS = -fobjc-arc -Wno-deprecated-declarations -I$(THEOS_PROJECT_DIR)/Headers \
	-DHB_VERSION='@"$(THEOS_PACKAGE_BASE_VERSION)"' -DHB_BUNDLE_URL='@"$(HB_BUNDLE_URL)"'
Heartblade_CCFLAGS = -std=c++17 -Wno-c++11-narrowing
Heartblade_FRAMEWORKS = Foundation UIKit
Heartblade_LDFLAGS = -undefined dynamic_lookup

include $(THEOS_MAKE_PATH)/tweak.mk
