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
let pageCounts = {};

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
    count.textContent = pageCounts[rule.id] ? String(pageCounts[rule.id]) : "";
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

async function showPageStats(tab) {
  if (!tab?.id) return;
  try {
    const r = await ext.tabs.sendMessage(tab.id, { type: "pageStats" }, { frameId: 0 });
    pageCounts = r.counts;
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    $("pageStats").textContent = total ? `${total} marks on this page (${r.unique} notes)` : "No known words on this page";
  } catch {
    pageCounts = {};
    $("pageStats").textContent = "Reload the page to highlight it";
  }
  renderRules();
}

async function init() {
  await refreshState();
  const tab = await initSiteToggle();
  showPageStats(tab);

  $("enabled").checked = cfg.enabled;
  $("enabled").addEventListener("change", (e) => store.set({ enabled: e.target.checked }));
  $("settings").addEventListener("click", () => ext.runtime.openOptionsPage());

  $("sync").addEventListener("click", async () => {
    const btn = $("sync");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    showError("");
    try {
      await call("sync");
    } catch (e) {
      showError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync from Anki";
    }
  });

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
    },
    (e) => {
      $("conn").className = "pill bad";
      $("conn").textContent = "offline";
      showError(e.message);
    }
  );
}

init();
