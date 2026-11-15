const $ = (id) => document.getElementById(id);
const ext = AnkiMarkConfig.ext;
const store = ext.storage.local;
const { loadConfig, syncSignature, hostOf, siteEntry, setSiteOff } = AnkiMarkConfig;

async function call(type, params = {}) {
  const res = await AnkiMarkConfig.message({ type, ...params });
  if (!res?.ok) throw new Error(res?.error || "No response from background");
  return res.result;
}

function showError(msg) {
  $("error").hidden = !msg;
  $("error").textContent = msg || "";
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

let cfg;
let host = ""; // the current tab's site, "" where AnkiMark can't run
let page = null; // pageStats from the content script

// Opening the popup syncs in the background when the last sync is older than this.
const SYNC_ON_OPEN_AFTER_MS = 60_000;

// Firefox treats host permissions as optional and may not grant them at install.
const ACCESS = { origins: ext.runtime.getManifest().host_permissions };

async function checkAccess() {
  const ok = await ext.permissions.contains(ACCESS).catch(() => true);
  $("access").hidden = ok;
  return ok;
}

async function refreshState() {
  cfg = await loadConfig([...Object.keys(AnkiMarkConfig.DEFAULTS), "syncInfo"]);
  const info = cfg.syncInfo;
  $("syncInfo").textContent = info ? `${info.words} words from ${info.notes} notes · ${timeAgo(info.time)}` : "Not synced yet";
  const noBase = !cfg.baseQuery.trim();
  const stale = info && info.signature !== syncSignature(cfg);
  $("stale").hidden = !(noBase || stale);
  $("stale").textContent = noBase
    ? "No base filter set, so rules search your whole collection. Set your deck under Rules & settings."
    : "Searches changed since the last sync.";
  renderToggles();
  renderRules();
  renderCoverage();
}

function renderToggles() {
  const entry = siteEntry(host, cfg.excludedHosts);
  $("enabled").checked = cfg.enabled;
  $("siteOn").checked = !!host && !entry;
  $("siteOn").disabled = !host || !cfg.enabled;
  $("host").textContent = host || "this page";
  $("siteHint").textContent = !cfg.enabled
    ? "AnkiMark is off everywhere"
    : !host
      ? "AnkiMark doesn't run on this page"
      : entry && entry !== host
        ? `Off for all of ${entry}`
        : "";
  document.body.classList.toggle("off", !cfg.enabled);
}

// Show the keyboard shortcuts in the switches' tooltips.
async function showShortcuts() {
  const switches = { "toggle-enabled": $("enabled"), "toggle-site": $("siteOn") };
  for (const { name, shortcut } of (await ext.commands?.getAll().catch(() => [])) ?? []) {
    if (switches[name] && shortcut) switches[name].title += ` (${shortcut})`;
  }
}

function renderRules() {
  const box = $("rules");
  box.innerHTML = "";
  for (const rule of cfg.rules) {
    const label = document.createElement("label");
    label.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = rule.enabled;
    cb.addEventListener("change", () => {
      rule.enabled = cb.checked;
      store.set({ rules: cfg.rules });
    });
    const sw = document.createElement("i");
    sw.className = "sw";
    sw.style.background = rule.color;
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = rule.name;
    name.title = rule.query;
    const count = document.createElement("span");
    count.className = "hint";
    const chars = page?.chars?.[rule.id] ?? 0;
    if (chars && page.total) {
      const words = page.words?.[rule.id];
      count.textContent = words ? `${plural(words, "word")} · ${percent(chars / page.total)}` : percent(chars / page.total);
      count.title = `Marked ${plural(page.marks[rule.id], "time")} on this page, ${percent(chars / page.total)} of its Japanese text`;
    }
    label.append(cb, sw, name, count);
    box.appendChild(label);
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function percent(x) {
  const p = x * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

// Share of the page's visible Japanese text (in characters) each rule marks.
function renderCoverage() {
  const box = $("coverage");
  if (!page?.active || !page.total) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const bar = $("covBar");
  bar.innerHTML = "";
  let known = 0;
  for (const rule of cfg.rules) {
    const chars = page.chars[rule.id] ?? 0;
    if (!rule.enabled || !chars) continue;
    known += chars;
    const seg = document.createElement("i");
    seg.style.width = `${(chars / page.total) * 100}%`;
    seg.style.background = rule.color;
    const words = page.words?.[rule.id];
    seg.title = `${rule.name}: ${words ? plural(words, "word") + ", " : ""}${percent(chars / page.total)}`;
    bar.appendChild(seg);
  }
  $("covPct").textContent = percent(known / page.total);
  $("covText").textContent = `of the Japanese text on this page is marked · ${plural(page.unique, "word")}`;
}

async function showPageStats(tab) {
  if (!tab?.id) return;
  try {
    page = await ext.tabs.sendMessage(tab.id, { type: "pageStats" }, { frameId: 0 });
    const on = cfg.enabled && !siteEntry(host, cfg.excludedHosts);
    $("pageStats").textContent = !page.active
      ? on ? "Nothing to highlight yet" : ""
      : page.total
        ? ""
        : "No Japanese text on this page";
  } catch {
    page = null;
    $("pageStats").textContent = "Reload the page to highlight it";
  }
  renderRules();
  renderCoverage();
}

async function init() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  host = hostOf(tab?.url ?? "");
  await refreshState();
  showPageStats(tab);
  showShortcuts();

  $("enabled").addEventListener("change", (e) => store.set({ enabled: e.target.checked }));
  $("siteOn").addEventListener("change", (e) => setSiteOff(host, !e.target.checked));
  $("settings").addEventListener("click", () => ext.runtime.openOptionsPage());

  async function runSync({ quiet = false } = {}) {
    const btn = $("sync");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    if (!quiet) showError("");
    try {
      await call("sync");
    } catch (e) {
      if (!quiet) showError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync from Anki";
    }
  }
  $("sync").addEventListener("click", () => runSync());

  // Page highlights refresh shortly after any settings change.
  let timer = 0;
  ext.storage.onChanged.addListener(() => {
    refreshState();
    clearTimeout(timer);
    timer = setTimeout(() => showPageStats(tab), 700);
  });

  // permissions.request must run straight from the click, before any await
  $("grantAccess").addEventListener("click", () => {
    ext.permissions.request(ACCESS).then(async (granted) => {
      if (granted && (await checkAccess())) location.reload();
    });
  });
  if (!(await checkAccess())) return;

  call("status").then(
    () => {
      $("conn").className = "pill ok";
      $("conn").textContent = "connected";
      const last = cfg.syncInfo?.time ?? 0;
      if (cfg.baseQuery.trim() && Date.now() - last > SYNC_ON_OPEN_AFTER_MS) runSync({ quiet: true });
    },
    (e) => {
      $("conn").className = "pill bad";
      $("conn").textContent = "offline";
      showError(e.message);
    }
  );
}

init();
