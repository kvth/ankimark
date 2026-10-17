// Minimal chrome.* stub so the content script and options page run on a plain web page.
(() => {
  const data = JSON.parse(localStorage.getItem("ankimark-stub") || "null") || {
    baseQuery: '"deck:kaishi"',
    dict: {
      "日本語": [["mature", 1]], "食べる": [["new", 3]], "書く": [["leech", 4], ["mature", 4], ["learning", 4]],
      "書類": [["learning", 9], ["new", 9]], "勉強": [["learning", 5]], "猫": [["mature", 10], ["learning", 10]], "ある": [["mature", 7]],
    },
  };
  const listeners = [];
  const persist = () => localStorage.setItem("ankimark-stub", JSON.stringify(data));
  const fake = {
    status: () => ({ version: 6 }),
    decks: () => ["kaishi", "Game Gengo::N5"],
    checkRules: ({ rules }) => Object.fromEntries(rules.map((r, i) => [r.id, /foo/.test(r.query) ? { error: "Invalid search" } : { count: 100 * (i + 1) }])),
    fields: () => ({ noteCount: 3, fields: ["Word", "Word Reading", "Sentence"] }),
    sync: () => ({ notes: 3, words: 7, time: Date.now(), signature: "x" }),
  };
  window.chrome = {
    storage: {
      local: {
        async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in data) o[k] = structuredClone(data[k]); return o; },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { newValue: v }; data[k] = structuredClone(v); }
          persist();
          listeners.forEach((l) => l(changes, "local"));
        },
      },
      onChanged: { addListener: (l) => listeners.push(l) },
    },
    tabs: {
      async query() { return [{ id: 1, url: "https://example.com/" }]; },
      async sendMessage() { return { counts: { mature: 12, learning: 3, new: 1 }, unique: 14 }; },
    },
    runtime: {
      async sendMessage(m) {
        console.log("sendMessage", JSON.stringify(m));
        return fake[m.type] ? { ok: true, result: fake[m.type](m) } : { ok: true };
      },
      onMessage: { addListener() {} },
      openOptionsPage() {},
    },
  };
  window.ankimarkStub = data;
})();
