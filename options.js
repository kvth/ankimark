const $ = (id) => document.getElementById(id);
const ext = AnkiMarkConfig.ext;
const store = ext.storage.local;
const { DEFAULTS, DEFAULT_RULES, loadConfig, deckQuery, syncSignature, newRuleId } = AnkiMarkConfig;

const EXAMPLES = [
  { name: "Leech", query: "prop:lapses>=8", color: "#e5484d" },
  { name: "Due today", query: "is:due", color: "#b45cff" },
  { name: "Forgot this week", query: "rated:7:1", color: "#ff6b3d" },
  { name: "Suspended", query: "is:suspended", color: "#9a9aa3" },
  { name: "Low recall (FSRS)", query: "prop:r<0.8", color: "#e5484d" },
  { name: "Tagged", query: "tag:important", color: "#00b3b3" },
  { name: "Everything else", query: "", color: "#9a9aa3" },
];

// Settings that go into an export file (everything except the API key).
const EXPORT_KEYS = [
  "baseQuery", "rules", "fields", "style", "opacity", "conjugations", "kanaMinLen", "enabled", "excludedHosts",
  "syncMinutes",
];

let cfg;
let ruleResults = {};

// Import reloads the page; start at the top so its message is visible.
history.scrollRestoration = "manual";

async function call(type, params = {}) {
  const res = await AnkiMarkConfig.message({ type, ...params });
  if (!res?.ok) throw new Error(res?.error || "No response from background");
  return res.result;
}

function showError(msg) {
  $("error").hidden = !msg;
  $("error").textContent = msg || "";
}

let saveTimer = 0;
function save(keys, delay = 300) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await store.set(Object.fromEntries(keys.map((k) => [k, cfg[k]])));
    updateStale();
  }, delay);
}

async function updateStale() {
  const { syncInfo } = await store.get("syncInfo");
  $("stale").hidden = !!syncInfo && syncInfo.signature === syncSignature(cfg);
  $("staleText").textContent = syncInfo ? "Searches or fields changed since the last sync." : "Not synced yet.";
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function renderRules() {
  const box = $("rules");
  box.innerHTML = "";
  cfg.rules.forEach((rule, i) => {
    const row = el("div", { className: "rule" + (rule.enabled ? "" : " disabled") });

    const up = el("button", { textContent: "▲", title: "Move up", disabled: i === 0 });
    const down = el("button", { textContent: "▼", title: "Move down", disabled: i === cfg.rules.length - 1 });
    const move = (d) => {
      const [r] = cfg.rules.splice(i, 1);
      cfg.rules.splice(i + d, 0, r);
      renderRules();
      save(["rules"], 0);
    };
    up.addEventListener("click", () => move(-1));
    down.addEventListener("click", () => move(1));

    const enabled = el("input", { type: "checkbox", checked: rule.enabled, title: "Show this rule" });
    enabled.addEventListener("change", () => {
      rule.enabled = enabled.checked;
      row.classList.toggle("disabled", !rule.enabled);
      save(["rules"], 0);
    });

    const color = el("input", { type: "color", value: rule.color, title: "Colour" });
    color.addEventListener("input", () => {
      rule.color = color.value;
      save(["rules"]);
    });

    const name = el("input", { type: "text", className: "name", value: rule.name, placeholder: "Name" });
    name.addEventListener("input", () => {
      rule.name = name.value;
      save(["rules"]);
    });

    const query = el("input", {
      type: "text", className: "query", value: rule.query, spellcheck: false,
      placeholder: "Anki search (empty = everything in the base filter)",
    });
    const result = el("span", { className: "result" });
    const r = ruleResults[rule.id];
    if (r) {
      result.textContent = r.error ? r.error : `${r.count} notes`;
      result.title = result.textContent;
      result.classList.toggle("bad", !!r.error);
    }
    query.addEventListener("input", () => {
      rule.query = query.value;
      delete ruleResults[rule.id];
      result.textContent = "";
      save(["rules"], 500);
    });

    const del = el("button", { className: "del", textContent: "✕", title: "Delete rule" });
    del.addEventListener("click", () => {
      cfg.rules.splice(i, 1);
      renderRules();
      save(["rules"], 0);
    });

    row.append(el("div", { className: "move" }, up, down), enabled, color, name, query, result, del);
    box.appendChild(row);
  });
}

function addRule(r) {
  cfg.rules.push({ id: newRuleId(), enabled: true, ...r });
  renderRules();
  save(["rules"], 0);
  const names = $("rules").querySelectorAll(".name");
  names[names.length - 1]?.focus();
}

function renderFields(fields) {
  const box = $("fields");
  box.innerHTML = "";
  // Keep ticked fields visible even if the sample didn't contain them.
  for (const name of [...new Set([...fields, ...cfg.fields])]) {
    const cb = el("input", { type: "checkbox", value: name, checked: cfg.fields.includes(name) });
    cb.addEventListener("change", () => {
      cfg.fields = [...box.querySelectorAll("input:checked")].map((i) => i.value);
      save(["fields"], 0);
    });
    box.append(el("label", { className: "check" }, cb, " " + name));
  }
  if (!box.children.length) box.append(el("span", { className: "hint", textContent: "No notes found." }));
}

async function checkRules() {
  showError("");
  try {
    ruleResults = await call("checkRules", { baseQuery: cfg.baseQuery, rules: cfg.rules });
    renderRules();
  } catch (e) {
    showError(e.message);
  }
}

async function init() {
  cfg = await loadConfig();

  // Base filter
  $("baseQuery").value = cfg.baseQuery;
  $("baseQuery").addEventListener("input", (e) => {
    cfg.baseQuery = e.target.value;
    showPickedDeck();
    ruleResults = {};
    renderRules();
    save(["baseQuery"], 500);
  });
  // A <select>, not a <datalist>: Firefox only offers datalist entries matching what is already typed.
  $("deckPick").addEventListener("change", (e) => {
    if (!e.target.value) return;
    $("baseQuery").value = e.target.value;
    $("baseQuery").dispatchEvent(new Event("input"));
  });

  // Rules
  renderRules();
  $("addRule").addEventListener("click", () => addRule({ name: "New rule", query: "", color: "#408cff" }));
  $("checkRules").addEventListener("click", checkRules);
  $("resetRules").addEventListener("click", () => {
    if (!confirm("Replace all rules with the default new / learning / mature rules?")) return;
    cfg.rules = structuredClone(DEFAULT_RULES);
    ruleResults = {};
    renderRules();
    save(["rules"], 0);
  });
  for (const ex of EXAMPLES) {
    const b = el("button", { textContent: ex.name, title: ex.query || "(matches everything in the base filter)" });
    b.addEventListener("click", () => addRule({ ...ex }));
    $("examples").append(b, " ");
  }

  // Fields
  if (cfg.fields.length) renderFields([]);
  $("loadFields").addEventListener("click", async () => {
    showError("");
    try {
      const { fields } = await call("fields", { baseQuery: cfg.baseQuery, rules: cfg.rules });
      renderFields(fields);
    } catch (e) {
      showError(e.message);
    }
  });

  // Display
  $("style").value = cfg.style;
  $("style").addEventListener("change", (e) => {
    cfg.style = e.target.value;
    save(["style"], 0);
  });
  const showOpacity = () => ($("opacityVal").textContent = `${cfg.opacity}%`);
  $("opacity").value = cfg.opacity;
  showOpacity();
  $("opacity").addEventListener("input", (e) => {
    cfg.opacity = Number(e.target.value);
    showOpacity();
    save(["opacity"]);
  });
  $("conjugations").checked = cfg.conjugations;
  $("conjugations").addEventListener("change", (e) => {
    cfg.conjugations = e.target.checked;
    save(["conjugations"], 0);
  });
  $("kanaMinLen").value = cfg.kanaMinLen;
  $("kanaMinLen").addEventListener("change", (e) => {
    cfg.kanaMinLen = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || DEFAULTS.kanaMinLen));
    e.target.value = cfg.kanaMinLen;
    save(["kanaMinLen"], 0);
  });

  // AnkiConnect
  $("ankiUrl").value = cfg.ankiUrl;
  $("ankiUrl").addEventListener("change", async (e) => {
    let url = e.target.value.trim() || DEFAULTS.ankiUrl;
    if (!/^https?:\/\//i.test(url)) url = "http://" + url;
    try {
      url = new URL(url).href.replace(/\/$/, "");
    } catch {
      showError(`"${e.target.value}" is not a valid address.`);
      return;
    }
    e.target.value = url;
    cfg.ankiUrl = url;
    await store.set({ ankiUrl: url });
    connect();
  });
  $("notesBatch").value = cfg.notesBatch;
  $("notesBatch").addEventListener("change", (e) => {
    cfg.notesBatch = Math.max(10, Math.min(1000, parseInt(e.target.value, 10) || DEFAULTS.notesBatch));
    e.target.value = cfg.notesBatch;
    save(["notesBatch"], 0);
  });
  $("syncMinutes").value = String(cfg.syncMinutes);
  $("syncMinutes").addEventListener("change", (e) => {
    cfg.syncMinutes = Number(e.target.value);
    save(["syncMinutes"], 0);
  });
  $("apiKey").value = cfg.apiKey;
  $("apiKey").addEventListener("change", async (e) => {
    cfg.apiKey = e.target.value.trim();
    await store.set({ apiKey: cfg.apiKey });
    connect();
  });

  $("syncNow").addEventListener("click", async () => {
    const btn = $("syncNow");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    showError("");
    try {
      clearTimeout(saveTimer);
      await store.set({ baseQuery: cfg.baseQuery, rules: cfg.rules, fields: cfg.fields });
      const info = await call("sync");
      $("staleText").textContent = `Synced ${info.words} words from ${info.notes} notes.`;
      setTimeout(updateStale, 2500);
    } catch (e) {
      showError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync now";
    }
  });

  $("export").addEventListener("click", exportSettings);
  $("import").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importSettings);
  const flash = sessionStorage.getItem("ankimark-import");
  if (flash) {
    sessionStorage.removeItem("ankimark-import");
    $("importMsg").textContent = flash;
    $("importMsg").hidden = false;
  }

  updateStale();
  connect();
}

function exportSettings() {
  clearTimeout(saveTimer);
  const data = { ankimark: ext.runtime.getManifest?.().version ?? "dev" };
  for (const k of EXPORT_KEYS) data[k] = cfg[k];
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const a = el("a", {
    href: URL.createObjectURL(blob),
    download: `ankimark-settings-${new Date().toLocaleDateString("sv")}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Checks an imported object and returns only valid settings; throws if it
// doesn't look like an AnkiMark settings file at all.
function parseImport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Not an AnkiMark settings file.");
  const out = {};
  const str = (v) => typeof v === "string";
  const strList = (v) => Array.isArray(v) && v.every(str);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

  if (str(data.baseQuery)) out.baseQuery = data.baseQuery;
  if (strList(data.fields)) out.fields = data.fields;
  if (strList(data.excludedHosts)) out.excludedHosts = data.excludedHosts;
  if (["background", "underline"].includes(data.style)) out.style = data.style;
  if (Number.isFinite(data.opacity)) out.opacity = clamp(data.opacity, 10, 80);
  if (Number.isFinite(data.kanaMinLen)) out.kanaMinLen = clamp(data.kanaMinLen, 1, 10);
  if (typeof data.conjugations === "boolean") out.conjugations = data.conjugations;
  if (typeof data.enabled === "boolean") out.enabled = data.enabled;
  if ([0, 1, 5, 15, 60].includes(data.syncMinutes)) out.syncMinutes = data.syncMinutes;

  if (data.rules !== undefined) {
    if (!Array.isArray(data.rules)) throw new Error("\"rules\" must be a list.");
    const ids = new Set();
    out.rules = data.rules.map((r, i) => {
      if (!r || typeof r !== "object" || !str(r.query)) throw new Error(`Rule ${i + 1} needs a "query" text.`);
      let id = str(r.id) && /^[\w-]+$/.test(r.id) && !ids.has(r.id) ? r.id : newRuleId();
      ids.add(id);
      return {
        id,
        name: str(r.name) && r.name.trim() ? r.name : `Rule ${i + 1}`,
        query: r.query,
        color: AnkiMarkConfig.isColor(r.color) ? r.color.toLowerCase() : "#888888",
        enabled: r.enabled !== false,
      };
    });
  }

  if (!Object.keys(out).length) throw new Error("No AnkiMark settings found in this file.");
  return out;
}

async function importSettings(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  showError("");
  try {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not valid JSON.`);
    }
    const settings = parseImport(data);
    clearTimeout(saveTimer);
    await store.set(settings);
    const count = settings.rules?.length;
    const n = settings.rules ? ` (${count} rule${count === 1 ? "" : "s"})` : "";
    sessionStorage.setItem("ankimark-import", `Imported settings from ${file.name}${n}.`);
    location.reload();
  } catch (err) {
    showError(`Import failed: ${err.message}`);
  }
}

// Show the deck in the picker when the base filter is exactly that deck.
function showPickedDeck() {
  const pick = $("deckPick");
  pick.value = [...pick.options].some((o) => o.value && o.value === cfg.baseQuery.trim()) ? cfg.baseQuery.trim() : "";
}

async function connect() {
  try {
    const decks = await call("decks");
    $("conn").className = "pill ok";
    $("conn").textContent = "connected";
    $("deckPick").replaceChildren(
      el("option", { value: "", textContent: "Choose…" }),
      ...decks.map((d) => el("option", { value: deckQuery(d), textContent: d }))
    );
    showPickedDeck();
    showError("");
    checkRules();
  } catch (e) {
    $("conn").className = "pill bad";
    $("conn").textContent = "offline";
    showError(e.message);
  }
}

init();
