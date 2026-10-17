importScripts("japanese.js", "config.js");

const { loadConfig, deckQuery, ruleQuery, unionQuery, syncSignature } = AnkiMarkConfig;

const ANKI_URL = "http://127.0.0.1:8765";
const RESYNC_MINUTES = 60;

async function anki(action, params = {}) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const body = { action, version: 6, params };
  if (apiKey) body.key = apiKey;
  let res;
  try {
    res = await fetch(ANKI_URL, { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    throw new Error("Anki is not reachable. Is Anki running with AnkiConnect installed?");
  }
  const json = await res.json();
  // Anki wraps parts of its messages in invisible bidi isolate marks.
  if (json.error) throw new Error(String(json.error).replace(/[\u2066-\u2069]/g, ""));
  return json.result;
}

// AnkiConnect only trusts listed origins; requestPermission pops up a dialog
// in Anki the first time so the user can allow this extension.
async function connect() {
  const perm = await anki("requestPermission");
  if (perm.permission !== "granted") {
    throw new Error("Permission denied in Anki. Allow AnkiMark in the AnkiConnect dialog.");
  }
  return perm;
}

async function notesInfo(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...(await anki("notesInfo", { notes: ids.slice(i, i + 500) })));
  }
  return out;
}

async function getFields(query) {
  const ids = await anki("findNotes", { query });
  const sample = await notesInfo(ids.slice(0, 300));
  const fields = new Map(); // name -> lowest order seen
  for (const note of sample) {
    for (const [name, f] of Object.entries(note.fields)) {
      fields.set(name, Math.min(fields.get(name) ?? Infinity, f.order));
    }
  }
  return {
    noteCount: ids.length,
    fields: [...fields.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n),
  };
}

async function findRuleNotes(base, rule) {
  const query = ruleQuery(base, rule.query);
  if (!query) throw new Error(`Rule "${rule.name}" has no search and there is no base filter.`);
  try {
    return await anki("findNotes", { query });
  } catch (e) {
    throw new Error(`Rule "${rule.name}": ${e.message}`);
  }
}

// dict: { word: [[ruleId, noteId], ...] } with one entry per matching rule.
// All rules are synced (also disabled ones) so that toggling, reordering and
// recolouring rules works without another sync.
async function sync() {
  const cfg = await loadConfig();
  await connect();
  const rulesByNote = new Map();
  for (const rule of cfg.rules) {
    for (const nid of await findRuleNotes(cfg.baseQuery, rule)) {
      if (!rulesByNote.has(nid)) rulesByNote.set(nid, []);
      rulesByNote.get(nid).push(rule.id);
    }
  }
  const notes = await notesInfo([...rulesByNote.keys()]);

  const dict = {};
  for (const note of notes) {
    let values = cfg.fields.filter((f) => note.fields[f]).map((f) => note.fields[f].value);
    if (!values.length) {
      const first = Object.values(note.fields).find((f) => f.order === 0);
      if (first) values = [first.value];
    }
    const ruleIds = rulesByNote.get(note.noteId);
    for (const v of values) {
      for (const word of AnkiMarkJP.extractWords(v)) {
        const entry = (dict[word] ??= []);
        for (const rid of ruleIds) if (!entry.some((e) => e[0] === rid)) entry.push([rid, note.noteId]);
      }
    }
  }

  const syncInfo = {
    notes: notes.length,
    words: Object.keys(dict).length,
    time: Date.now(),
    signature: syncSignature(cfg),
  };
  await chrome.storage.local.set({ dict, syncInfo });
  return syncInfo;
}

const handlers = {
  async status() {
    const perm = await connect();
    return { version: perm.version };
  },
  async decks() {
    await connect();
    return (await anki("deckNames")).sort((a, b) => a.localeCompare(b));
  },
  async fields({ baseQuery, rules }) {
    await connect();
    const query = unionQuery(baseQuery, rules);
    if (!query) throw new Error("Add a base filter or a rule search first.");
    return getFields(query);
  },
  // Note count per rule, or the search error, for the options page.
  async checkRules({ baseQuery, rules }) {
    await connect();
    const out = {};
    for (const rule of rules) {
      try {
        out[rule.id] = { count: (await findRuleNotes(baseQuery, rule)).length };
      } catch (e) {
        out[rule.id] = { error: e.message.replace(/^Rule "[^"]*": /, "") };
      }
    }
    return out;
  },
  sync,
  async browse({ nid }) {
    await anki("guiBrowse", { query: `nid:${nid}` });
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

function scheduleResync() {
  chrome.alarms.create("resync", { periodInMinutes: RESYNC_MINUTES });
}

// Settings from 0.1 had a single deck and fixed new/learning/mature levels.
async function migrate() {
  const s = await chrome.storage.local.get(["deck", "levels", "baseQuery"]);
  if (s.deck === undefined && s.levels === undefined) return;
  if (s.deck && s.baseQuery === undefined) await chrome.storage.local.set({ baseQuery: deckQuery(s.deck) });
  await chrome.storage.local.remove(["deck", "levels", "dict"]);
  sync().catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleResync();
  migrate();
});
chrome.runtime.onStartup.addListener(() => {
  scheduleResync();
  sync().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "resync") sync().catch(() => {});
});
