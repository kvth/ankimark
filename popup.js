const $ = (id) => document.getElementById(id);
const ext = AnkiMarkConfig.ext;
const store = ext.storage.local;
const { loadConfig, syncSignature } = AnkiMarkConfig;

async function call(type, params = {}) {
  const res = await ext.runtime.sendMessage({ type, ...params });
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
  renderRules();
  renderCoverage();
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
      count.textContent = `${percent(chars / page.total)}`;
      count.title = `${page.marks[rule.id]} words on this page`;
    }
    label.append(cb, sw, name, count);
    box.appendChild(label);
  }
}

async function initSiteToggle() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try {
    const url = new URL(tab?.url || "");
    if (url.protocol.startsWith("http") || url.protocol === "file:") host = url.hostname;
  } catch {}
  const cb = $("siteOff");
  if (!host) {
    cb.disabled = true;
    $("host").textContent = "this page";
  } else {
    $("host").textContent = host;
    cb.checked = cfg.excludedHosts.includes(host);
    cb.addEventListener("change", async () => {
      const { excludedHosts } = await loadConfig(["excludedHosts"]);
      const set = new Set(excludedHosts);
      cb.checked ? set.add(host) : set.delete(host);
      await store.set({ excludedHosts: [...set] });
    });
  }
  return tab;
}

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
    seg.title = `${rule.name}: ${percent(chars / page.total)}`;
    bar.appendChild(seg);
  }
  $("covPct").textContent = percent(known / page.total);
  $("covText").textContent = `of the Japanese text on this page is marked (${page.unique} notes)`;
}

async function showPageStats(tab) {
  if (!tab?.id) return;
  try {
    page = await ext.tabs.sendMessage(tab.id, { type: "pageStats" }, { frameId: 0 });
    $("pageStats").textContent = !page.active
      ? "Highlighting is off on this page"
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
  await refreshState();
  const tab = await initSiteToggle();
  showPageStats(tab);

  $("enabled").checked = cfg.enabled;
  $("enabled").addEventListener("change", (e) => store.set({ enabled: e.target.checked }));
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
