// Runs the field script in a hidden sandbox.html frame and waits for the
// answer. Loaded by Firefox's background page and by Chrome's offscreen
// document (Chrome's service worker has no DOM to hold the frame).
(function (root) {
  "use strict";
  const ext = root.browser ?? root.chrome;
  const TIMEOUT_MS = 60_000;

  let frame = null; // Promise<HTMLIFrameElement>
  let nextId = 1;
  const pending = new Map(); // id -> { source, resolve }

  function ready() {
    frame ??= new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.addEventListener("load", () => resolve(iframe), { once: true });
      iframe.src = ext.runtime.getURL("sandbox.html");
      (document.body ?? document.documentElement).appendChild(iframe);
    });
    return frame;
  }

  addEventListener("message", (e) => {
    const p = pending.get(e.data?.id);
    if (!p || e.source !== p.source) return;
    pending.delete(e.data.id);
    p.resolve(e.data);
  });

  // Removes the frame; the next run starts a fresh one.
  async function close() {
    const f = frame;
    frame = null;
    (await f)?.remove();
  }

  // Per note { words } or { error }; throws if the script doesn't compile,
  // can't run here, or takes too long.
  async function run(code, notes) {
    const iframe = await ready();
    const id = nextId++;
    let timer;
    const reply = await new Promise((resolve, reject) => {
      pending.set(id, { source: iframe.contentWindow, resolve });
      timer = setTimeout(() => {
        pending.delete(id);
        close();
        reject(new Error(`Field script took longer than ${TIMEOUT_MS / 1000} s for ${notes.length} notes.`));
      }, TIMEOUT_MS);
      iframe.contentWindow.postMessage({ id, code, notes }, "*");
    }).finally(() => clearTimeout(timer));
    if (reply.error) {
      // Without sandbox support (Firefox before 154) the page gets the normal extension CSP.
      if (/^EvalError/.test(reply.error)) throw new Error("Field scripts need Firefox 154 or newer (or Chrome).");
      throw new Error(`Field script: ${reply.error}`);
    }
    return reply.results;
  }

  root.AnkiMarkSandbox = { run, close };
})(globalThis);
