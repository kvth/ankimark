# AMO API keys (WEB_EXT_API_KEY, WEB_EXT_API_SECRET) live in .env, which is not committed
-include .env
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

IGNORE := --ignore-files test "test/**" Makefile .env

.PHONY: build lint sign test clean

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

clean:
	rm -rf web-ext-artifacts
