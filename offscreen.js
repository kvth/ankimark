// Chrome only: holds the field script's sandbox frame for the background
// service worker, which has no DOM of its own.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "runFieldScript") return false;
  AnkiMarkSandbox.run(msg.code, msg.notes)
    .then((results) => sendResponse({ ok: true, result: results }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});
