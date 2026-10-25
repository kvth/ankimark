// Chrome runs this as a service worker; Firefox as a background page that
// already loaded these via manifest background.scripts.
if (typeof importScripts === "function") importScripts("japanese.js", "config.js");

// Firefox has promise-based `browser`; Chrome only `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;

const { loadConfig, deckQuery, ruleQuery, unionQuery, syncSignature, DEFAULTS } = AnkiMarkConfig;

// One request at a time: AnkiConnect Android hands each straight to AnkiDroid,
// and the popup, the settings page and a sync can all ask at once.
let ankiQueue = Promise.resolve();
function anki(action, params = {}) {
  const res = ankiQueue.then(() => ankiRequest(action, params));
  ankiQueue = res.catch(() => {});
  return res;
}

async function ankiRequest(action, params) {
  const { apiKey, ankiUrl } = await loadConfig(["apiKey", "ankiUrl"]);
  const body = { action, version: 6, params };
  if (apiKey) body.key = apiKey;
  let res;
  try {
    res = await fetch(ankiUrl.trim() || DEFAULTS.ankiUrl, { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    throw Object.assign(new Error(`Anki is not reachable at ${ankiUrl}. Is Anki running with AnkiConnect?`), {
      unreachable: true,
    });
  }
  const json = await res.json();
  // Anki wraps parts of its messages in invisible bidi isolate marks.
  if (json.error) throw new Error(String(json.error).replace(/[\u2066-\u2069]/g, ""));
  return json.result;
}

// AnkiConnect only trusts listed origins; requestPermission pops up a dialog
// in Anki the first time so the user can allow this extension.
// AnkiConnect Android (with AnkiDroid) has no requestPermission, notesModTime
// or origin check: when Anki answers but rejects the action, deckNames
// confirms it serves us, and the unsupported actions are skipped from then on.
let ankiConnectAndroid = false;
async function connect() {
  let perm;
  try {
    if (ankiConnectAndroid) throw new Error("no requestPermission");
    perm = await anki("requestPermission");
  } catch (e) {
    if (e.unreachable) throw e;
    await anki("deckNames");
    ankiConnectAndroid = true;
    return { permission: "granted", version: null };
  }
  if (perm.permission !== "granted") {
    throw new Error("Permission denied in Anki. Allow AnkiMark in the AnkiConnect dialog.");
  }
  return perm;
}

// Small batches: AnkiConnect Android builds each answer in memory several times.
async function* noteBatches(ids) {
  const { notesBatch } = await loadConfig(["notesBatch"]);
  const batch = Math.max(10, Math.min(1000, notesBatch || DEFAULTS.notesBatch));
  for (let i = 0; i < ids.length; i += batch) yield await anki("notesInfo", { notes: ids.slice(i, i + batch) });
}

async function notesInfo(ids) {
  const out = [];
  for await (const batch of noteBatches(ids)) out.push(...batch);
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

// A note's words: its ticked fields (or, having none of them, its first
// field) plus what the field script returned for it.
function noteWords(note, fields, scriptWords = []) {
  let values = fields.filter((f) => note.fields[f]).map((f) => note.fields[f].value);
  if (!values.length) {
    const first = Object.values(note.fields).find((f) => f.order === 0);
    if (first) values = [first.value];
  }
  return [...new Set([...values, ...scriptWords].flatMap((v) => AnkiMarkJP.extractWords(v)))];
}

// ---- Field script --------------------------------------------------------
//
// The user's JavaScript (cfg.fieldScript, a function body taking `note`)
// runs in sandbox.html, the only page allowed to compile code. Firefox's
// background page holds that frame itself; Chrome's service worker has no
// DOM, so there it lives in an offscreen document.

// The note as the script sees it.
function scriptNote(note) {
  return {
    noteId: note.noteId,
    modelName: note.modelName,
    tags: note.tags,
    fields: Object.fromEntries(Object.entries(note.fields).map(([name, f]) => [name, f.value])),
  };
}

const hasDom = typeof document !== "undefined";
let offscreen = null; // Promise while Chrome's offscreen document is open
let offscreenClosed = Promise.resolve();
let sandboxUsers = 0;

// Per note { words } or { error }.
async function runFieldScript(code, notes) {
  notes = notes.map(scriptNote);
  if (hasDom) return AnkiMarkSandbox.run(code, notes);
  offscreen ??= offscreenClosed.then(() =>
    ext.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["IFRAME_SCRIPTING"],
      justification: "Runs the user's field script in a sandboxed frame.",
    })
  );
  await offscreen;
  const res = await ext.runtime.sendMessage({ type: "runFieldScript", code, notes });
  if (!res?.ok) throw new Error(res?.error || "No answer from the field script.");
  return res.result;
}

// Removes the sandbox frame (and the offscreen document) when the last user is done.
async function withSandbox(fn) {
  sandboxUsers++;
  try {
    return await fn();
  } finally {
    if (--sandboxUsers === 0) {
      if (hasDom) AnkiMarkSandbox.close();
      else if (offscreen) {
        offscreenClosed = offscreen.then(() => ext.offscreen.closeDocument()).catch(() => {});
        offscreen = null;
      }
    }
  }
}

// When each note was last edited, or null where AnkiConnect lacks
// notesModTime (AnkiConnect Android, old versions).
async function modTimes(ids) {
  if (ankiConnectAndroid) return null;
  try {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 1000) {
      for (const { noteId, mod } of await anki("notesModTime", { notes: ids.slice(i, i + 1000) })) out.set(noteId, mod);
    }
    return out;
  } catch (e) {
    if (e.unreachable) throw e;
    return null;
  }
}

const FULL_REREAD_MS = 24 * 60 * 60 * 1000;

// dict: { word: [[ruleId, noteId], ...] } with one entry per matching rule.
// All rules are synced (also disabled ones) so that toggling, reordering and
// recolouring rules works without another sync.
//
// Note words are cached (noteCache) so a sync only reads notes that are new
// or were edited since the last one; the rule searches run every time, as
// cards move between new / learning / mature with every review.
async function runSync() {
  const cfg = await loadConfig([...Object.keys(DEFAULTS), "noteCache", "dict"]);
  await connect();
  const rulesByNote = new Map();
  for (const rule of cfg.rules) {
    for (const nid of await findRuleNotes(cfg.baseQuery, rule)) {
      if (!rulesByNote.has(nid)) rulesByNote.set(nid, []);
      rulesByNote.get(nid).push(rule.id);
    }
  }
  const ids = [...rulesByNote.keys()];

  // A changed field list, field script or Anki address invalidates every cached note.
  const script = cfg.fieldScript.trim();
  const source = JSON.stringify([cfg.ankiUrl.trim(), [...cfg.fields].sort(), ...(script ? [script] : [])]);
  const mods = await modTimes(ids);
  // Without edit times, re-read everything once a day so edited notes catch up.
  const fresh = cfg.noteCache?.source === source && (mods || Date.now() - cfg.noteCache.fullAt < FULL_REREAD_MS);
  const cached = fresh ? cfg.noteCache.notes : {};
  const fullAt = fresh ? cfg.noteCache.fullAt : Date.now();
  const notes = {};
  const stale = [];
  for (const id of ids) {
    const hit = cached[id];
    if (hit && (!mods || hit.mod === mods.get(id))) notes[id] = hit;
    else stale.push(id);
  }
  await withSandbox(async () => {
    for await (const batch of noteBatches(stale)) {
      const scripted = script ? await runFieldScript(script, batch) : [];
      batch.forEach((note, i) => {
        const r = scripted[i];
        if (r?.error) throw new Error(`Field script failed on note ${note.noteId}: ${r.error}`);
        notes[note.noteId] = { mod: mods?.get(note.noteId) ?? note.mod ?? 0, words: noteWords(note, cfg.fields, r?.words) };
      });
    }
  });

  const dict = {};
  for (const id of ids) {
    for (const word of notes[id]?.words ?? []) {
      const entry = (dict[word] ??= []);
      for (const rid of rulesByNote.get(id)) if (!entry.some((e) => e[0] === rid)) entry.push([rid, id]);
    }
  }

  const syncInfo = {
    notes: ids.length,
    words: Object.keys(dict).length,
    read: stale.length,
    time: Date.now(),
    signature: syncSignature(cfg),
  };
  const update = { syncInfo, noteCache: { source, fullAt, notes } };
  // Every open tab re-highlights when the word list changes, so only write it when it did.
  if (JSON.stringify(dict) !== JSON.stringify(cfg.dict)) update.dict = dict;
  await ext.storage.local.set(update);
  return syncInfo;
}

// Firefox stops an idle background page after 30 s even while it waits on
// Anki, which on Android (slow AnkiDroid searches) kills long syncs. Any
// extension API call resets that timer, so make a cheap one while work runs.
async function keepAlive(promise) {
  const timer = setInterval(() => ext.runtime.getPlatformInfo().catch(() => {}), 20_000);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

// One sync at a time: the alarm, the popup and the settings page may all ask.
let running = null;
function sync() {
  running ??= keepAlive(runSync()).finally(() => (running = null));
  return running;
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
  // Words of a few notes, to try the fields and the field script on.
  async testFields({ baseQuery, rules, fields, fieldScript, search }) {
    await connect();
    const query = ruleQuery(unionQuery(baseQuery, rules), search);
    if (!query) throw new Error("Add a base filter or a rule search first.");
    const notes = await notesInfo((await anki("findNotes", { query })).slice(0, 5));
    const script = fieldScript.trim();
    const scripted = script ? await withSandbox(() => runFieldScript(script, notes)) : [];
    return notes.map((note, i) => ({
      noteId: note.noteId,
      fieldWords: noteWords(note, fields),
      scriptWords: scripted[i]?.words && [...new Set(scripted[i].words.flatMap((v) => AnkiMarkJP.extractWords(v)))],
      returned: scripted[i]?.words,
      error: scripted[i]?.error,
    }));
  },
  sync: () => sync(),
  async browse({ nid }) {
    await anki("guiBrowse", { query: `nid:${nid}` });
    return true;
  },
};

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  keepAlive(h(msg))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

async function scheduleResync() {
  const { syncMinutes } = await loadConfig(["syncMinutes"]);
  await ext.alarms.clear("resync");
  if (syncMinutes > 0) ext.alarms.create("resync", { periodInMinutes: syncMinutes });
}

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("syncMinutes" in changes) scheduleResync();
  // Another address may be desktop Anki again.
  if ("ankiUrl" in changes) ankiConnectAndroid = false;
});

// Settings from 0.1 had a single deck and fixed new/learning/mature levels.
async function migrate() {
  const s = await ext.storage.local.get(["deck", "levels", "baseQuery"]);
  if (s.deck === undefined && s.levels === undefined) return;
  if (s.deck && s.baseQuery === undefined) await ext.storage.local.set({ baseQuery: deckQuery(s.deck) });
  await ext.storage.local.remove(["deck", "levels", "dict"]);
  sync().catch(() => {});
}

ext.runtime.onInstalled.addListener(() => {
  scheduleResync();
  migrate();
});
ext.runtime.onStartup.addListener(() => {
  scheduleResync();
  sync().catch(() => {});
});
ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "resync") sync().catch(() => {});
});
