IGNORE := --ignore-files test "test/**" Makefile

.PHONY: build lint test clean

# Package for AMO upload: web-ext-artifacts/ankimark-<version>.zip
build:
	npx web-ext build $(IGNORE) --overwrite-dest

lint:
	npx web-ext lint $(IGNORE)

test:
	node --test test/*.test.mjs

clean:
	rm -rf web-ext-artifacts
