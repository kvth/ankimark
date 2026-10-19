(() => {
  "use strict";
  const { JP_CHAR, Matcher } = self.AnkiMarkJP;
  const { ext, loadConfig, isColor } = self.AnkiMarkConfig;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "SVG", "MATH", "IFRAME", "CANVAS", "RT", "RP",
  ]);
  const MARK_CLASS = "ankimark";
  const CHUNK = 400;
  const WATCHED_KEYS = [
    "dict", "enabled", "excludedHosts", "kanaMinLen", "conjugations", "style", "opacity", "rules",
  ];

  let matcher = null;
  let ruleNames = {};
  let active = false;
  let observer = null;
  let pending = new Set();
  let pendingTimer = 0;

  const host = location.hostname;

  function shouldSkip(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || e.classList?.contains(MARK_CLASS) || e.isContentEditable) return true;
    }
    return false;
  }

  function collectTextNodes(root) {
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && JP_CHAR.test(root.nodeValue) && !shouldSkip(root.parentElement)) nodes.push(root);
      return nodes;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return nodes;
    if (root.nodeType === Node.ELEMENT_NODE && shouldSkip(root)) return nodes;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          return SKIP_TAGS.has(n.tagName) || n.classList.contains(MARK_CLASS) || n.isContentEditable
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        return JP_CHAR.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    return nodes;
  }

  function markNode(node) {
    const text = node.nodeValue;
    const matches = matcher.find(text);
    if (!matches.length || !node.parentNode) return;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const m of matches) {
      if (m.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.start)));
      const [ruleId, nid] = m.entry;
      const span = document.createElement("span");
      span.className = MARK_CLASS;
      span.dataset.rule = ruleId;
      span.dataset.nid = nid;
      span.title = `${m.word}${m.inflected ? " (conjugated)" : ""} · ${ruleNames[ruleId]} · Alt+click to open in Anki`;
      span.textContent = text.slice(m.start, m.end);
      frag.appendChild(span);
      pos = m.end;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }

  function markNodes(nodes) {
    let i = 0;
    const step = () => {
      if (!active) return;
      pause();
      const end = Math.min(i + CHUNK, nodes.length);
      for (; i < end; i++) markNode(nodes[i]);
      resume();
      if (i < nodes.length) setTimeout(step, 0);
    };
    step();
  }

  function unmarkAll() {
    pause();
    const parents = new Set();
    for (const span of document.querySelectorAll(`span.${MARK_CLASS}`)) {
      parents.add(span.parentNode);
      span.replaceWith(document.createTextNode(span.textContent));
    }
    for (const p of parents) p?.normalize();
  }

  function pause() {
    if (!observer) return;
    // Keep mutations that happened before we touch the DOM ourselves.
    queueMutations(observer.takeRecords());
    observer.disconnect();
  }

  function resume() {
    if (observer && active) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function queueMutations(records) {
    for (const r of records) {
      if (r.type === "characterData") pending.add(r.target);
      else for (const n of r.addedNodes) pending.add(n);
    }
    if (pending.size && !pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = 0;
        const roots = [...pending].filter((n) => n.isConnected);
        pending = new Set();
        const nodes = [];
        for (const r of roots) nodes.push(...collectTextNodes(r));
        if (nodes.length) markNodes(nodes);
      }, 300);
    }
  }

  function start() {
    if (!document.body || !matcher?.size) return;
    active = true;
    observer ??= new MutationObserver(queueMutations);
    markNodes(collectTextNodes(document.body));
    resume();
  }

  function stop() {
    active = false;
    observer?.disconnect();
    pending = new Set();
    unmarkAll();
  }

  function applyStyle(rules, cfg) {
    const root = document.documentElement;
    root.dataset.ankimarkStyle = cfg.style;
    root.style.setProperty("--ankimark-opacity", `${Math.max(5, Math.min(100, cfg.opacity))}%`);
    let el = document.getElementById("ankimark-colors");
    if (!el) {
      el = document.createElement("style");
      el.id = "ankimark-colors";
      (document.head || root).appendChild(el);
    }
    el.textContent = rules
      .filter((r) => isColor(r.color) && /^[\w-]+$/.test(r.id))
      .map((r) => `span.ankimark[data-rule="${r.id}"] { --ankimark-color: ${r.color}; }`)
      .join("\n");
  }

  async function refresh() {
    const cfg = await loadConfig(WATCHED_KEYS);
    stop();
    const rules = cfg.rules.filter((r) => r.enabled);
    ruleNames = Object.fromEntries(rules.map((r) => [r.id, r.name]));
    applyStyle(rules, cfg);

    // Each word gets the first enabled rule (in list order) that any of its notes matched.
    const rank = new Map(rules.map((r, i) => [r.id, i]));
    const entries = {};
    for (const [word, matches] of Object.entries(cfg.dict || {})) {
      let best = null;
      for (const m of Array.isArray(matches) ? matches : []) {
        if (rank.has(m[0]) && (!best || rank.get(m[0]) < rank.get(best[0]))) best = m;
      }
      if (best) entries[word] = best;
    }
    matcher = new Matcher(entries, { kanaMinLen: cfg.kanaMinLen, conjugations: cfg.conjugations });
    if (cfg.enabled && !cfg.excludedHosts.includes(host)) start();
  }

  function countJapanese(text) {
    let n = 0;
    for (const ch of text) if (JP_CHAR.test(ch)) n++;
    return n;
  }

  // How much of the page's visible Japanese text is marked, in characters,
  // in total and per rule. Hidden text (menus, collapsed sections) is left out.
  function pageStats() {
    const marks = {};
    const chars = {};
    const unique = new Set();
    for (const span of document.querySelectorAll(`span.${MARK_CLASS}`)) {
      if (span.checkVisibility && !span.checkVisibility()) continue;
      const rule = span.dataset.rule;
      marks[rule] = (marks[rule] || 0) + 1;
      chars[rule] = (chars[rule] || 0) + countJapanese(span.textContent);
      unique.add(span.dataset.nid);
    }
    return {
      active,
      marks,
      chars,
      total: countJapanese(document.body?.innerText ?? ""),
      unique: unique.size,
    };
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return;
      const span = e.target.closest?.(`span.${MARK_CLASS}`);
      if (!span) return;
      e.preventDefault();
      e.stopPropagation();
      ext.runtime.sendMessage({ type: "browse", nid: Number(span.dataset.nid) });
    },
    true
  );

  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "pageStats" || window !== window.top) return false;
    sendResponse(pageStats());
    return false;
  });

  let refreshTimer = 0;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !WATCHED_KEYS.some((k) => k in changes)) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 150);
  });

  refresh();
})();
