// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { Matcher, deinflect, extractWords } = createRequire(import.meta.url)("../japanese.js");

const found = (text, words, opts) => {
  const m = new Matcher(Object.fromEntries(words.map((w) => [w, w])), opts);
  return m.find(text).map((x) => `${text.slice(x.start, x.end)}=${x.word}`);
};

test("deinflects verbs, adjectives and chains back to the dictionary form", () => {
  const cases = {
    食べた: "食べる", 食べない: "食べる", 食べなかった: "食べる", 食べます: "食べる",
    食べませんでした: "食べる", 食べたい: "食べる", 食べたかった: "食べる", 食べられる: "食べる",
    食べさせられなかった: "食べる", 食べている: "食べる", 食べてる: "食べる", 食べていた: "食べる",
    食べちゃった: "食べる", 食べれば: "食べる", 食べよう: "食べる",
    書いた: "書く", 書いて: "書く", 書かない: "書く", 書きます: "書く", 書ける: "書く",
    書かれた: "書く", 書こう: "書く", 書けば: "書く", 書いておく: "書く", 書いとく: "書く",
    泳いだ: "泳ぐ", 話した: "話す", 待った: "待つ", 死んだ: "死ぬ", 遊んだ: "遊ぶ",
    読んだ: "読む", 帰った: "帰る", 買った: "買う", 買わない: "買う", 行った: "行く", 行って: "行く",
    わかった: "わかる", 勉強した: "勉強する", 勉強しません: "勉強する", 勉強できる: "勉強する",
    来た: "来る", 来ない: "来る", 来ます: "来る", こなかった: "くる", きた: "くる",
    高かった: "高い", 高くて: "高い", 高くない: "高い", 高くなかった: "高い", 高ければ: "高い",
    よかった: "いい", 行かなきゃ: "行く", 食べたら: "食べる", 読んだり: "読む",
  };
  for (const [form, base] of Object.entries(cases)) {
    assert.ok(deinflect(form).includes(base), `${form} -> ${base}, got ${deinflect(form).slice(0, 8)}`);
  }
  assert.ok(deinflect("勉強した").includes("勉強"), "する verbs also give the noun");
});

test("matches the whole inflected word and names its dictionary form", () => {
  assert.deepEqual(found("昨日パンを食べなかった。", ["食べる", "パン"]), ["パン=パン", "食べなかった=食べる"]);
  assert.deepEqual(found("手紙を書いておいた", ["書く", "手紙"]), ["手紙=手紙", "書いておいた=書く"]);
  assert.deepEqual(found("毎日勉強しています", ["勉強"]), ["勉強しています=勉強"]);
  assert.deepEqual(found("もうわかった", ["わかる"]), ["わかった=わかる"]);
});

test("prefers the longest word and never overlaps", () => {
  assert.deepEqual(found("日本語を話した", ["日本", "日本語", "話す"]), ["日本語=日本語", "話した=話す"]);
});

test("does not stretch a word over unrelated text", () => {
  // 書類 is a different word; 書く must not grab it
  assert.deepEqual(found("書類を書くと", ["書く", "書類"]), ["書類=書類", "書く=書く"]);
  assert.deepEqual(found("学校で", ["学校"]), ["学校=学校"]);
  // particles after a verb are not part of it
  assert.deepEqual(found("食べたのは", ["食べる"]), ["食べた=食べる"]);
});

test("with conjugations off, only words as written match", () => {
  assert.deepEqual(found("食べた。食べる", ["食べる"], { conjugations: false }), ["食べる=食べる"]);
});

test("skips short kana-only words", () => {
  assert.deepEqual(found("これはペン", ["は", "ペン"]), ["ペン=ペン"]);
  assert.deepEqual(found("これはペン", ["は", "ペン"], { kanaMinLen: 1 }), ["は=は", "ペン=ペン"]);
});

test("extractWords cleans Anki fields", () => {
  assert.deepEqual(extractWords(" 日本[にほん] 語[ご]"), ["日本語"]);
  assert.deepEqual(extractWords("<ruby>漢字<rt>かんじ</rt></ruby>"), ["漢字"]);
  assert.deepEqual(extractWords("食べる、喰べる"), ["食べる", "喰べる"]);
  assert.deepEqual(extractWords("勉強（する）"), ["勉強"]);
});
