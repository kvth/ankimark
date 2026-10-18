// Shared Japanese text helpers. Loaded by the content script, by the
// background service worker (importScripts) and by the node tests.
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
  // deinflect() undoes Japanese verb and adjective endings step by step:
  // 食べさせられなかった -> 食べさせられない -> 食べさせられる -> 食べさせる -> 食べる.
  // Each rule turns an ending back into a simpler one. The word types stop
  // nonsense chains: a rule only applies to a form of the type it produces
  // (e.g. ない-forms behave like i-adjectives, so なかった -> ない works,
  // but ない is never taken as the past of something).

  const V1 = 1; // ichidan verb (食べる)
  const V5 = 2; // godan verb (書く)
  const VK = 4; // 来る
  const VS = 8; // する verb
  const ADJ = 16; // i-adjective, and forms that inflect like one (ない, たい)
  const MASU = 32; // ます form
  const TE = 64; // て form
  const END = 128; // a form nothing else attaches to (past, ば, volitional, ...)
  const BASE = 256; // a plain word, e.g. 勉強 from 勉強する
  const ANY = 511;

  // [ending, replacement, type of the ending's form, type of the result]
  const RULES = [];
  const rule = (from, to, fromType, toType) => RULES.push([from, to, fromType, toType]);

  // Godan verbs, by final kana: a-, i-, e-, o-row, then the て and た forms.
  const GODAN = [
    ["う", "わ", "い", "え", "お", "って", "った"],
    ["く", "か", "き", "け", "こ", "いて", "いた"],
    ["ぐ", "が", "ぎ", "げ", "ご", "いで", "いだ"],
    ["す", "さ", "し", "せ", "そ", "して", "した"],
    ["つ", "た", "ち", "て", "と", "って", "った"],
    ["ぬ", "な", "に", "ね", "の", "んで", "んだ"],
    ["ぶ", "ば", "び", "べ", "ぼ", "んで", "んだ"],
    ["む", "ま", "み", "め", "も", "んで", "んだ"],
    ["る", "ら", "り", "れ", "ろ", "って", "った"],
  ];
  for (const [u, a, i, e, o, te, ta] of GODAN) {
    rule(a + "ない", u, ADJ, V5); // 書かない
    rule(a + "ず", u, END, V5);
    rule(a + "れる", u, V1, V5); // passive 書かれる
    rule(a + "せる", u, V1, V5); // causative 書かせる
    rule(i + "ます", u, MASU, V5); // 書きます
    rule(i + "たい", u, ADJ, V5); // 書きたい
    rule(i + "ながら", u, END, V5);
    rule(i + "すぎる", u, V1, V5);
    rule(e + "る", u, V1, V5); // potential 書ける
    rule(e + "ば", u, END, V5); // 書けば
    rule(o + "う", u, END, V5); // volitional 書こう
    rule(te, u, TE, V5); // 書いて
    rule(ta, u, END, V5); // 書いた
  }
  // 行く is irregular in て/た
  for (const k of ["行", "い"]) {
    rule(k + "って", k + "く", TE, V5);
    rule(k + "った", k + "く", END, V5);
  }

  // Ichidan verbs
  for (const [from, type] of [
    ["ない", ADJ], ["ず", END], ["ます", MASU], ["たい", ADJ], ["ながら", END], ["すぎる", V1],
    ["られる", V1], ["させる", V1], ["れば", END], ["よう", END], ["て", TE], ["た", END],
  ]) {
    rule(from, "る", type, V1);
  }

  // する and 来る
  for (const [from, type] of [
    ["しない", ADJ], ["せず", END], ["します", MASU], ["したい", ADJ], ["しながら", END],
    ["される", V1], ["させる", V1], ["できる", V1], ["すれば", END], ["しろ", END], ["しよう", END],
    ["して", TE], ["した", END],
  ]) {
    rule(from, "する", type, VS);
  }
  rule("する", "", VS, BASE); // 勉強する -> 勉強
  // 来る: the kanji stays 来, in kana the vowel changes (きた, こない, くれば)
  for (const [ki, ko, ku, kuru] of [["来", "来", "来", "来る"], ["き", "こ", "く", "くる"]]) {
    rule(ki + "ます", kuru, MASU, VK);
    rule(ki + "たい", kuru, ADJ, VK);
    rule(ki + "て", kuru, TE, VK);
    rule(ki + "た", kuru, END, VK);
    rule(ko + "ない", kuru, ADJ, VK);
    rule(ko + "られる", kuru, V1, VK);
    rule(ko + "させる", kuru, V1, VK);
    rule(ko + "よう", kuru, END, VK);
    rule(ku + "れば", kuru, END, VK);
  }

  // i-adjectives (and ない / たい forms, which inflect the same way)
  for (const [from, type] of [
    ["かった", END], ["くて", TE], ["く", END], ["ければ", END], ["くない", ADJ],
    ["さ", BASE], ["そう", END], ["すぎる", V1],
  ]) {
    rule(from, "い", type, ADJ);
  }
  for (const [from, type] of [["よかった", END], ["よくて", TE], ["よく", END], ["よければ", END], ["よくない", ADJ]]) {
    rule(from, "いい", type, ADJ);
  }
  rule("なきゃ", "ない", END, ADJ);
  rule("なくちゃ", "ない", END, ADJ);

  // ます forms
  for (const [from, type] of [["ました", END], ["ません", END], ["ませんでした", END], ["ましょう", END], ["まして", TE]]) {
    rule(from, "ます", type, MASU);
  }

  // Endings attached to the て form
  for (const [te, de, type] of [
    ["ている", "でいる", V1], ["てる", "でる", V1], ["ておく", "でおく", V5], ["とく", "どく", V5],
    ["てしまう", "でしまう", V5], ["ちゃう", "じゃう", V5], ["てある", "である", V5],
  ]) {
    rule(te, "て", type, TE);
    rule(de, "で", type, TE);
  }
  rule("たら", "た", END, END);
  rule("だら", "だ", END, END);
  rule("たり", "た", END, END);
  rule("だり", "だ", END, END);

  // An ichidan verb's stem ends in an i- or e-row kana or in kanji (食べる, 起きる, 見る).
  const ICHIDAN_STEM_END = /[いきぎしじちぢにひびぴみりえけげせぜてでねへべぺめれ々〆㐀-䶿一-鿿]$/;

  // Is `base`, made by a rule of result type `toType`, a plausible word?
  function plausible(base, to, toType) {
    if (toType === V1 && to === "る") return ICHIDAN_STEM_END.test(base.slice(0, -1));
    if (toType === BASE) return base.length >= 2; // 勉強する -> 勉強, but not 登場する -> 場
    if (toType === ADJ && to === "い") return base !== "いい"; // いい inflects as よかった, よく
    return true;
  }

  const MAX_STEPS = 8;
  const deinflectCache = new Map();

  // Every dictionary form `text` could be an inflection of (not including text itself).
  function deinflect(text) {
    const cached = deinflectCache.get(text);
    if (cached) return cached;
    const seen = new Map([[text, ANY]]);
    let frontier = [[text, ANY]];
    for (let step = 0; step < MAX_STEPS && frontier.length; step++) {
      const next = [];
      for (const [form, type] of frontier) {
        for (const [from, to, fromType, toType] of RULES) {
          if (!(type & fromType) || !form.endsWith(from)) continue;
          const base = form.slice(0, form.length - from.length) + to;
          if (!base || !plausible(base, to, toType)) continue;
          const known = seen.get(base) ?? 0;
          if ((known & toType) === toType) continue;
          seen.set(base, known | toType);
          next.push([base, toType]);
        }
      }
      frontier = next;
    }
    seen.delete(text);
    const forms = [...seen.keys()];
    if (deinflectCache.size > 20000) deinflectCache.clear();
    deinflectCache.set(text, forms);
    return forms;
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

  // entries: { word: anything }; the value is handed back as match.entry
  class Matcher {
    constructor(entries, opts = {}) {
      const kanaMinLen = opts.kanaMinLen ?? 2;
      this.conjugations = opts.conjugations ?? true;
      this.exact = new Map();
      this.stems = new Set();
      this.stemPrefixes = new Set();
      for (const [word, entry] of Object.entries(entries || {})) {
        if (KANA_ONLY.test(word) && word.length < kanaMinLen) continue;
        this.exact.set(word, entry);
        const stem = wordStem(word);
        this.stems.add(stem);
        for (let i = 1; i <= stem.length; i++) this.stemPrefixes.add(stem.slice(0, i));
      }
    }

    get size() {
      return this.exact.size;
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
        const entry = this.exact.get(candidate);
        if (entry) return { start: i, end: j, word: candidate, entry, inflected: false };
        if (this.conjugations && j - i > longestStem) {
          const word = deinflect(candidate).find((f) => this.exact.has(f) && inflects(f));
          if (word) return { start: i, end: j, word, entry: this.exact.get(word), inflected: true };
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

  const api = { JP_CHAR, extractWords, deinflect, wordStem, Matcher };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnkiMarkJP = api;
})(typeof self !== "undefined" ? self : globalThis);
