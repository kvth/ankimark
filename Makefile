# AMO API keys (WEB_EXT_API_KEY, WEB_EXT_API_SECRET) live in .env, which is not committed
-include .env
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

# yomitan-deinflect.js is built from vendor/, so the package only needs the former
IGNORE := --ignore-files test "test/**" Makefile .env vendor "vendor/**" scripts "scripts/**"

.PHONY: build lint sign test clean yomitan

# Package for AMO upload: web-ext-artifacts/ankimark-<version>.zip
build:
	npx web-ext build $(IGNORE) --overwrite-dest

lint:
	npx web-ext lint $(IGNORE)

# Sign as unlisted on AMO; the signed .xpi lands in web-ext-artifacts/
sign:
	npx web-ext sign $(IGNORE) --channel=unlisted

test:
	node --test test/*.test.mjs

# Re-vendor Yomitan's deinflection and rebuild yomitan-deinflect.js: make yomitan TAG=<release tag>
TAG ?= 26.11.2.0
yomitan:
	node scripts/update-yomitan.mjs $(TAG)

clean:
	rm -rf web-ext-artifacts
