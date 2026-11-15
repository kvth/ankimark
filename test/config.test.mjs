// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

createRequire(import.meta.url)("../config.js");
const { hostOf, parseHost, siteEntry } = globalThis.AnkiMarkConfig;

test("hostOf only accepts web pages", () => {
  assert.equal(hostOf("https://www.example.com/a?b"), "www.example.com");
  assert.equal(hostOf("http://localhost:8080/"), "localhost");
  assert.equal(hostOf("chrome://extensions"), "");
  assert.equal(hostOf("about:blank"), "");
  assert.equal(hostOf("file:///home/x.html"), "");
  assert.equal(hostOf(""), "");
});

test("parseHost turns typed sites into hosts", () => {
  assert.equal(parseHost("Example.com"), "example.com");
  assert.equal(parseHost("  https://news.example.com/page#x "), "news.example.com");
  assert.equal(parseHost("*.example.com"), "example.com");
  assert.equal(parseHost("example.com/path"), "example.com");
  assert.equal(parseHost(""), null);
  assert.equal(parseHost("ftp://example.com"), null);
  assert.equal(parseHost("not a host"), null);
});

test("siteEntry matches the host and its parent domains", () => {
  const list = ["example.com", "only.test.org"];
  assert.equal(siteEntry("example.com", list), "example.com");
  assert.equal(siteEntry("www.example.com", list), "example.com");
  assert.equal(siteEntry("a.b.example.com", list), "example.com");
  assert.equal(siteEntry("notexample.com", list), null);
  assert.equal(siteEntry("test.org", list), null);
  assert.equal(siteEntry("only.test.org", list), "only.test.org");
  assert.equal(siteEntry("", list), null);
});
