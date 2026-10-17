// Shared settings helpers. Loaded by background, content script, popup and options page.
(function (root) {
  "use strict";

  // Rules are checked top to bottom; a word gets the colour of the first
  // enabled rule that one of its notes matches.
  const DEFAULT_RULES = [
    { id: "leech", name: "Leech", query: "prop:lapses>=4", color: "#e5484d", enabled: false },
    { id: "mature", name: "Mature", query: "prop:ivl>=21", color: "#28c85a", enabled: true },
    { id: "learning", name: "Learning", query: "-is:new", color: "#ffa600", enabled: true },
    { id: "new", name: "New", query: "is:new", color: "#408cff", enabled: true },
  ];

  const DEFAULTS = {
    enabled: true,
    excludedHosts: [],
    kanaMinLen: 2,
    conjugations: true,
    style: "background",
    opacity: 35,
    baseQuery: "",
    rules: DEFAULT_RULES,
    fields: [],
    apiKey: "",
  };

  async function loadConfig(keys = Object.keys(DEFAULTS)) {
    const s = await chrome.storage.local.get(keys);
    const out = {};
    for (const k of keys) out[k] = s[k] ?? (k in DEFAULTS ? structuredClone(DEFAULTS[k]) : undefined);
    return out;
  }

  function deckQuery(deck) {
    return `"deck:${deck.replace(/[\\"*_]/g, (c) => "\\" + c)}"`;
  }

  // Full Anki search for one rule: base filter AND rule search.
  function ruleQuery(base, query) {
    const parts = [base, query].map((p) => (p || "").trim()).filter(Boolean);
    return parts.length ? parts.map((p) => `(${p})`).join(" ") : null;
  }

  // Search matching every note any rule can match (used to list fields).
  function unionQuery(base, rules) {
    const qs = rules.map((r) => ruleQuery(base, r.query)).filter(Boolean);
    return qs.length ? qs.map((q) => `(${q})`).join(" OR ") : null;
  }

  // What a sync depends on; when this changes the word list is stale.
  function syncSignature(cfg) {
    return JSON.stringify([cfg.baseQuery.trim(), cfg.rules.map((r) => [r.id, r.query.trim()]), [...cfg.fields].sort()]);
  }

  const isColor = (c) => /^#[0-9a-f]{6}$/i.test(c);
  const newRuleId = () => "r" + Math.random().toString(36).slice(2, 8);

  root.AnkiMarkConfig = {
    DEFAULT_RULES, DEFAULTS, loadConfig, deckQuery, ruleQuery, unionQuery, syncSignature, isColor, newRuleId,
  };
})(self);
