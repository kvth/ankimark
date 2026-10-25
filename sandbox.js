// Runs the user's field script. This page is a manifest "sandbox" page: an
// opaque origin without extension APIs, the only place an extension may
// compile code from text. The parent posts { id, code, notes } and gets back
// { id, results: [{ words } | { error }] } (one per note) or { id, error }.
"use strict";

function wordList(value) {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  throw new TypeError("must return an array of strings");
}

addEventListener("message", (e) => {
  const { id, code, notes } = e.data || {};
  let reply;
  try {
    const fn = new Function("note", code);
    reply = {
      id,
      results: notes.map((note) => {
        try {
          return { words: wordList(fn(note)) };
        } catch (err) {
          return { error: String(err?.message ?? err) };
        }
      }),
    };
  } catch (err) {
    reply = { id, error: `${err?.name ?? "Error"}: ${err?.message ?? err}` };
  }
  e.source.postMessage(reply, "*");
});
