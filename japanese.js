// Shared Japanese text helpers. Loaded by the content script, by the
// background service worker (importScripts) and by the node tests.
(function (root) {
  "use strict";

  const JP_RANGES =
    "々〆぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ";
  const JP_CHAR = new RegExp("[" + JP_RANGES + "]");
  const JP_ONLY = new RegExp("^[" + JP_RANGES + "]+$");
  const KANA_ONLY = /^[぀-ゟ゠-ヿｦ-ﾟ]+$/;
  const KANJI = /[々〆㐀-䶿一-鿿豈-﫿]/;
  const HIRAGANA = /[ぁ-ゟ]/;
  const TRIM_NON_JP = new RegExp("^[^" + JP_RANGES + "]+|[^" + JP_RANGES + "]+$", "g");

  const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }

  // Turn an Anki field value (HTML, furigana, cloze, ...) into a list of
  // plain Japanese words.
  function extractWords(html) {
    let s = String(html || "");
    s = s.replace(/\[sound:[^\]]*\]/g, " ");
    s = s.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1");
    s = s.replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    s = s.replace(/<br\s*\/?>|<\/(div|p|li|tr|h\d)>/gi, "\n");
    s = s.replace(/<[^>]*>/g, "");
    s = decodeEntities(s);
    // Anki furigana syntax: " 日本[にほん] 語[ご]" -> "日本語"
    s = s.replace(/ ?([^\s\[\]]*)\[[぀-ヿ・ー]*\]/g, "$1");
    // Optional parts like 勉強（する） or 〜的
    s = s.replace(/[（(][^）)]*[）)]/g, " ");
    s = s.replace(/[〜～~]/g, "");

    const out = [];
    for (let tok of s.split(/[\s、,，;；/／|｜。]+/)) {
      tok = tok.replace(TRIM_NON_JP, "");
      if (tok && tok.length <= 20 && JP_ONLY.test(tok)) out.push(tok);
    }
    return out;
  }

  // Rough dictionary-form -> stem mapping so that 食べた / 書いて / 高かった
  // still hit 食べる / 書く / 高い. Only for words whose stem contains kanji,
  // and a stem only matches when it is followed by hiragana.
  function stemOf(word) {
    if (word.length < 2) return null;
    let stem = null;
    if (word.endsWith("する") && word.length > 2) stem = word.slice(0, -2);
    else if (/[うくぐすつぬぶむるい]$/.test(word)) stem = word.slice(0, -1);
    if (!stem || !KANJI.test(stem) || !HIRAGANA.test(word.slice(stem.length))) return null;
    return stem;
  }

  // entries: { word: anything }; the value is handed back as match.entry
  class Matcher {
    constructor(entries, opts = {}) {
      const kanaMinLen = opts.kanaMinLen ?? 2;
      const conjugations = opts.conjugations ?? true;
      this.exact = new Map();
      this.stems = new Map();
      this.maxLen = 0;
      for (const [word, entry] of Object.entries(entries || {})) {
        if (KANA_ONLY.test(word) && word.length < kanaMinLen) continue;
        this.exact.set(word, entry);
        this.maxLen = Math.max(this.maxLen, word.length);
        if (conjugations) {
          const stem = stemOf(word);
          if (stem && !this.stems.has(stem)) this.stems.set(stem, { word, entry });
        }
      }
    }

    get size() {
      return this.exact.size;
    }

    // Returns non-overlapping matches, longest first, scanning left to right.
    find(text) {
      const matches = [];
      if (!this.maxLen) return matches;
      const n = text.length;
      let i = 0;
      while (i < n) {
        if (!JP_CHAR.test(text[i])) {
          i++;
          continue;
        }
        let best = null;
        const limit = Math.min(this.maxLen, n - i);
        for (let len = limit; len > 0; len--) {
          const sub = text.substr(i, len);
          if (!JP_CHAR.test(sub[len - 1])) continue;
          const e = this.exact.get(sub);
          if (e) {
            best = { start: i, end: i + len, word: sub, entry: e, inflected: false };
            break;
          }
        }
        for (let len = limit; len > (best ? best.end - i : 0); len--) {
          const s = this.stems.get(text.substr(i, len));
          if (s && i + len < n && HIRAGANA.test(text[i + len])) {
            best = { start: i, end: i + len, word: s.word, entry: s.entry, inflected: true };
            break;
          }
        }
        if (best) {
          matches.push(best);
          i = best.end;
        } else {
          i++;
        }
      }
      return matches;
    }
  }

  const api = { JP_CHAR, extractWords, stemOf, Matcher };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnkiMarkJP = api;
})(typeof self !== "undefined" ? self : globalThis);
