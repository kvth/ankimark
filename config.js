// Shared settings helpers. Loaded by background, content script, popup and options page.
(function (root) {
  "use strict";
  const ext = root.browser ?? root.chrome;

  // Rules are checked top to bottom; a word gets the colour of the first
  // enabled rule that one of its notes matches.
  const DEFAULT_RULES = [
    { id: "leech", name: "Leech", query: "prop:lapses>=8", color: "#e5484d", enabled: false },
    { id: "mature", name: "Mature", query: "prop:ivl>=21", color: "#28c85a", enabled: true },
    { id: "learning", name: "Learning", query: "-is:new", color: "#ffa600", enabled: true },
    { id: "new", name: "New", query: "is:new", color: "#408cff", enabled: true },
  ];

  const DEFAULTS = {
    enabled: true,
    excludedHosts: [],
    kanaMinLen: 2,
    conjugations: true,
    kanaVariants: true, // ゴミ also matches ごみ and vice versa
    style: "background",
    opacity: 35,
    baseQuery: "",
    rules: DEFAULT_RULES,
    fields: [],
    fieldScript: "", // JavaScript function body: note -> extra words
    apiKey: "",
    ankiUrl: "http://localhost:8765",
    syncMinutes: 5, // 0 = only on demand
    notesBatch: 100, // notes per notesInfo request
  };

  async function loadConfig(keys = Object.keys(DEFAULTS)) {
    const s = await ext.storage.local.get(keys);
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
  // (No field script leaves the signature as it was before scripts existed.)
  function syncSignature(cfg) {
    const script = cfg.fieldScript.trim();
    return JSON.stringify([
      cfg.baseQuery.trim(), cfg.rules.map((r) => [r.id, r.query.trim()]), [...cfg.fields].sort(), ...(script ? [script] : []),
    ]);
  }

  // Message the background. Firefox suspends an idle background page, and the
  // message meant to wake it can fail with "Receiving end does not exist"
  // (often on Android), so retry a few times.
  async function message(msg) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await ext.runtime.sendMessage(msg);
      } catch (e) {
        if (attempt >= 4 || !/receiving end does not exist/i.test(e?.message)) throw e;
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }

  // Host of a page AnkiMark can run on, else "".
  function hostOf(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.hostname : "";
    } catch {
      return "";
    }
  }

  // A typed site ("https://Example.com/page", "*.example.com") as a host, or null.
  function parseHost(input) {
    let s = String(input).trim().toLowerCase().replace(/^\*\./, "");
    if (!s) return null;
    if (!/^[a-z][a-z\d+.-]*:\/\//.test(s)) s = "http://" + s;
    return hostOf(s) || null;
  }

  const covers = (entry, host) => host === entry || host.endsWith("." + entry);

  // The excludedHosts entry that turns AnkiMark off on `host`: the host
  // itself or a parent domain (example.com also covers www.example.com).
  function siteEntry(host, excludedHosts) {
    return (host && excludedHosts.find((h) => covers(h, host))) || null;
  }

  // Turns AnkiMark off or on for `host`. Turning it on drops every entry that
  // covers the host, parent domains included.
  async function setSiteOff(host, off) {
    const { excludedHosts } = await loadConfig(["excludedHosts"]);
    const list = off ? [...new Set([...excludedHosts, host])] : excludedHosts.filter((h) => !covers(h, host));
    await ext.storage.local.set({ excludedHosts: list });
  }

  const isColor = (c) => /^#[0-9a-f]{6}$/i.test(c);
  const newRuleId = () => "r" + Math.random().toString(36).slice(2, 8);

  root.AnkiMarkConfig = {
    ext, DEFAULT_RULES, DEFAULTS, loadConfig, deckQuery, ruleQuery, unionQuery, syncSignature, message,
    hostOf, parseHost, siteEntry, setSiteOff, isColor, newRuleId,
  };
})(globalThis);
