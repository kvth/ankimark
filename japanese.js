// Shared Japanese text helpers. Loaded by the content script, by the
// background service worker (importScripts) and by the node tests, each time
// after yomitan-deinflect.js.
(function (root) {
  "use strict";

  const JP_RANGES =
    "々〆぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ";
  const JP_CHAR = new RegExp("[" + JP_RANGES + "]");
  const JP_ONLY = new RegExp("^[" + JP_RANGES + "]+$");
  const KANA_ONLY = /^[぀-ゟ゠-ヿｦ-ﾟ]+$/;
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

  // ---- Conjugated forms -------------------------------------------------
  //
  // deinflect() uses Yomitan's Japanese deinflection rules and engine
  // (yomitan-deinflect.js, built from vendor/yomitan by scripts/update-yomitan.mjs):
  // 食べさせられなかった -> 食べさせられない -> 食べさせられる -> 食べさせる -> 食べる.
  // Each result says which word types it can be (v1, v5, adj-i, ...). Yomitan checks
  // that against the part of speech of dictionary entries; Anki notes don't have one,
  // so every result that can be some dictionary form counts.

  const Yomitan = typeof module !== "undefined" && module.exports ? require("./yomitan-deinflect.js") : root.YomitanDeinflect;

  let transformer = null;
  let dictionaryForms = 0; // condition flags of all dictionary forms
  let suru = 0;

  function yomitan() {
    if (!transformer) {
      transformer = new Yomitan.LanguageTransformer();
      transformer.addDescriptor(Yomitan.japaneseTransforms);
      dictionaryForms = transformer.getConditionFlagsFromPartsOfSpeech(Object.keys(Yomitan.japaneseTransforms.conditions));
      suru = transformer.getConditionFlagsFromConditionType("vs");
    }
    return transformer;
  }

  const deinflectCache = new Map();

  // Every dictionary form `text` could be an inflection of (not including text itself).
  function deinflect(text) {
    const cached = deinflectCache.get(text);
    if (cached) return cached;
    const forms = new Set();
    for (const { text: form, conditions } of yomitan().transform(text)) {
      if (conditions & dictionaryForms) forms.add(form);
      // Not in Yomitan: する verbs are noted as the noun (勉強した -> 勉強する -> 勉強).
      // Single-kanji ones (愛する) are words of their own.
      if ((conditions === 0 || conditions & suru) && form.endsWith("する") && form.length >= 4) forms.add(form.slice(0, -2));
    }
    forms.delete(text);
    const result = [...forms];
    if (deinflectCache.size > 20000) deinflectCache.clear();
    deinflectCache.set(text, result);
    return result;
  }

  // ---- Matching ------------------------------------------------------------

  // Inflection only changes a word's hiragana tail, so a match always starts
  // with the word's stem: 食べる -> 食, 勉強する -> 勉強, 高い -> 高.
  // All-kana words keep all but their last two characters.
  function wordStem(word) {
    const stem = word.replace(/[ぁ-ゟ]+$/, "");
    return stem || word.slice(0, Math.max(1, word.length - 2));
  }

  // Longest inflected tail a match may carry past its stem (食べさせられなかった).
  const MAX_INFLECTION = 10;
  const HIRAGANA = /[ぁ-ゟ]/;

  // Short kana words are mostly nouns and particles (いつ, くつ), so only the
  // common kana verbs (ある, いる, なる, する, いう, ...) are matched inflected.
  const inflects = (word) => !(KANA_ONLY.test(word) && word.length <= 2 && !/[るう]$/.test(word));

  // Hiragana and katakana sit 0x60 apart (ぁ/ァ ... ゖ/ヶ, ゝ/ヽ, ゞ/ヾ).
  const shiftKana = (s, re, by) => s.replace(re, (c) => String.fromCharCode(c.charCodeAt(0) + by));
  const toHiragana = (s) => shiftKana(s, /[ァ-ヶヽヾ]/g, -0x60);
  const toKatakana = (s) => shiftKana(s, /[ぁ-ゖゝゞ]/g, 0x60);

  // entries: { word: anything }; the value is handed back as match.entry
  class Matcher {
    constructor(entries, opts = {}) {
      const kanaMinLen = opts.kanaMinLen ?? 2;
      this.conjugations = opts.conjugations ?? true;
      this.exact = new Map();
      this.variantOf = new Map(); // other-kana spelling -> word as in the notes
      this.stems = new Set();
      this.stemPrefixes = new Set();
      const kanaWords = [];
      for (const [word, entry] of Object.entries(entries || {})) {
        const kana = KANA_ONLY.test(word);
        if (kana && word.length < kanaMinLen) continue;
        this.add(word, entry);
        if (kana) kanaWords.push(word);
      }
      // ゴミ also matches ごみ and the other way round, unless a note has that
      // spelling itself.
      if (opts.kanaVariants ?? true) {
        for (const word of kanaWords) {
          for (const v of [toHiragana(word), toKatakana(word)]) {
            if (this.exact.has(v)) continue;
            this.add(v, this.exact.get(word));
            this.variantOf.set(v, word);
          }
        }
      }
    }

    add(word, entry) {
      this.exact.set(word, entry);
      const stem = wordStem(word);
      this.stems.add(stem);
      for (let i = 1; i <= stem.length; i++) this.stemPrefixes.add(stem.slice(0, i));
    }

    // A match for `word` (a key of this.exact), named as in the notes.
    result(start, end, word, inflected) {
      const variant = this.variantOf.has(word);
      return { start, end, word: variant ? this.variantOf.get(word) : word, entry: this.exact.get(word), inflected, variant };
    }

    get size() {
      return this.exact.size - this.variantOf.size;
    }

    // The longest known word starting at i, as written or (with conjugations
    // on) inflected; null if none.
    matchAt(text, i) {
      let longestStem = 0;
      for (let j = i + 1; j <= text.length; j++) {
        const prefix = text.slice(i, j);
        if (!this.stemPrefixes.has(prefix)) break;
        if (this.stems.has(prefix)) longestStem = j - i;
      }
      if (!longestStem) return null;
      // Inflection endings are hiragana: a match can only run on through them.
      let end = i + longestStem;
      const limit = Math.min(text.length, end + MAX_INFLECTION);
      while (end < limit && HIRAGANA.test(text[end])) end++;
      for (let j = end; j > i; j--) {
        const candidate = text.slice(i, j);
        if (this.exact.has(candidate)) return this.result(i, j, candidate, false);
        if (this.conjugations && j - i > longestStem) {
          const word = deinflect(candidate).find((f) => this.exact.has(f) && inflects(f));
          if (word) return this.result(i, j, word, true);
        }
      }
      return null;
    }

    // Non-overlapping matches, longest first, scanning left to right.
    find(text) {
      const matches = [];
      if (!this.exact.size) return matches;
      let i = 0;
      while (i < text.length) {
        const m = JP_CHAR.test(text[i]) ? this.matchAt(text, i) : null;
        if (m) {
          matches.push(m);
          i = m.end;
        } else {
          i++;
        }
      }
      return matches;
    }
  }

  const api = { JP_CHAR, extractWords, deinflect, wordStem, toHiragana, toKatakana, Matcher };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnkiMarkJP = api;
})(globalThis);
