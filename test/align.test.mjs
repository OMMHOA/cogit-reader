import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseBlocks, parseSections } from "../lib/blocks.ts";
import { align, toUnits } from "../lib/align.ts";

// The books repo, checked out next to this one.
const BOOKS = new URL("../../islamic-books-hun/", import.meta.url);
const read = (f) => readFileSync(new URL(f, BOOKS), "utf8");
const have = (...files) => files.every((f) => existsSync(new URL(f, BOOKS)));
const arDigits = (s) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

test("units: page markers, footnote lists, the Arabic per-page notes", () => {
  const ar = "[صفحة 5]\n\n# عنوان\n\nنص أول(١) هنا\n\n> (١) حاشية أولى\n> (٢) حاشية ثانية\n[صفحة 6]\n\nنص ثان\n";
  const a = toUnits(ar);
  assert.deepEqual(
    a.map((u) => [u.kind, u.page, u.note]),
    [["head", "5", null], ["body", "5", null], ["note", "5", 1], ["note", "5", 2], ["body", "6", null]],
  );
  assert.deepEqual(a[1].markers, [1]);
  const en = "Text¹ and²\n\n## Footnotes\n\n¹ One.\n² Two.\n\nmore of two\n\n---\n\n# Next\n";
  assert.deepEqual(
    toUnits(en).map((u) => [u.kind, u.note, u.cont]),
    [["body", null, false], ["note", 1, false], ["note", 2, false], ["note", 2, true], ["sep", null, false], ["head", null, false]],
  );
});

test("align: headings, a split paragraph, a footnote, a section only the translation has", () => {
  const x = (n) => "x".repeat(n);
  const lens = [500, 320, 760, 410, 280, 650, 330];
  const filler = (k, scale) => lens.map((n, i) => `${k}${i} ${x(Math.round(n * scale))}`);
  const glossary = ["a", "b", "c", "d", "e", "f"].map((w) => `*${w}*: ${x(120)}`);
  const hun = [
    "# Könyv", "## Egy", `A ${x(200)}`, `B¹ ${x(400)}`, `C ${x(150)}`, ...filler("E", 1), "## Lábjegyzetek",
    `¹ Jegyzet ${x(50)}`, "## Kettő", `D ${x(300)}`, ...filler("F", 1), "## Három", ...filler("G", 1),
    "## Szójegyzék", ...glossary,
  ].join("\n\n");
  // The other version's notes come at the very end, like Fiqh's English ch9.
  const other = [
    "# Book", "## One", `A ${x(190)}`, `B¹ ${x(200)}`, `B2 ${x(190)}`, `C ${x(140)}`, ...filler("E", 0.9), "## Two",
    `D ${x(280)}`, ...filler("F", 0.9), "## Three", ...filler("G", 0.9), "## Footnotes", `¹ Note ${x(45)}`,
  ].join("\n\n");
  const { units, map } = align(hun, other);
  const shown = parseBlocks(hun).map((b) => (map.get(b.index) ?? []).map((j) => units[j].text.split(" ")[0]));
  const same = (k) => lens.map((_, i) => [`${k}${i}`]);
  assert.deepEqual(shown, [
    ["#"], ["##"], ["A"], ["B¹", "B2"], ["C"], ...same("E"), [], ["¹"], ["##"], ["D"], ...same("F"), ["##"], ...same("G"),
    [], ...glossary.map(() => []),
  ]);
});

const FIQH = "fiqh-us-seerah/FiqhusSeerah-Muhammad-al-Ghazali-";
const MH = "muslim-home/MuslimHome-Muhammad-Salih-al-Munajjid-";

// A real book against one of its versions: what the Hungarian units are matched with.
function real(hunFile, otherFile) {
  const hun = read(hunFile);
  const { units, map } = align(hun, read(otherFile));
  return { hun, units: toUnits(hun), got: (u) => (map.get(u.block) ?? []).map((j) => units[j]), map };
}
const share = (list, ok) => list.filter(ok).length / list.length;

test("real book: Fiqh, Hungarian ↔ English", { skip: !have(FIQH + "HUN-full.md", FIQH + "ENG-full.md") }, () => {
  const { units, got } = real(FIQH + "HUN-full.md", FIQH + "ENG-full.md");
  // The footnote numbers are the same in both, so they check the matching.
  const marked = units.filter((u) => u.kind === "body" && u.markers.length);
  assert.ok(share(marked, (u) => u.markers.every((m) => got(u).some((t) => t.markers.includes(m)))) > 0.98);
  const notes = units.filter((u) => u.kind === "note" && !u.cont);
  assert.ok(share(notes, (u) => got(u)[0]?.note === u.note) > 0.98);
  assert.ok(units.filter((u) => u.kind === "head").every((u) => got(u).some((t) => t.kind === "head")));
  const quotes = units.filter((u) => /\(Korán \d+: ?\d+/.test(u.text));
  assert.ok(share(quotes, (u) => got(u).some((t) => t.text.includes("(Qur'ān"))) > 0.98);
});

test("real book: Fiqh, Hungarian ↔ Arabic", { skip: !have(FIQH + "HUN-full.md", FIQH + "AR-full.md") }, () => {
  const { hun, units, got, map } = real(FIQH + "HUN-full.md", FIQH + "AR-full.md");
  const marked = units.filter((u) => u.kind === "body" && u.markers.length);
  assert.ok(share(marked, (u) => got(u).flatMap((t) => t.markers).length >= u.markers.length) > 0.92);
  const notes = units.filter((u) => u.kind === "note" && !u.cont);
  assert.ok(share(notes, (u) => got(u).some((t) => t.kind === "note")) > 0.9);
  // A quote's verse number is in the matched Arabic, next to a Qur'ān bracket.
  const quotes = units.filter((u) => u.kind === "body" && /\(Korán \d+: ?\d+/.test(u.text));
  const verse = (u) => new RegExp(`(^|\\D)${/\(Korán \d+: ?(\d+)/.exec(u.text)[1]}(\\D|$)`);
  assert.ok(share(quotes, (u) => got(u).some((t) => verse(u).test(arDigits(t.text))) && got(u).some((t) => t.quran)) > 0.9);
  // Sections only the translation has (the Arabic has none of them) stay unmatched; nearly
  // everything else is matched.
  const blocks = parseBlocks(hun);
  const only = new Set();
  for (const s of parseSections(blocks))
    if (/Hadísz-terminológia|jelek|nevek|Szójegyzék/.test(s.title)) for (let i = s.first; i <= s.last; i++) only.add(i);
  assert.ok(only.size > 50);
  assert.ok([...only].every((i) => !(map.get(i) ?? []).length));
  const rest = blocks.filter((b) => !only.has(b.index) && !/^(---|#+ Lábjegyzetek)$/.test(b.text));
  assert.ok(share(rest, (b) => (map.get(b.index) ?? []).length > 0) > 0.99);
});

test("real book: Muslim Home, Hungarian ↔ Arabic", { skip: !have(MH + "HUN.md", MH + "AR.md") }, () => {
  const { units, got } = real(MH + "HUN.md", MH + "AR.md");
  // The forty numbered recommendations: each heading matches the Arabic one with its number.
  const items = units.filter((u) => /^### \((\d+)\)/.test(u.text));
  assert.equal(items.length, 40);
  for (const u of items) {
    const n = /\((\d+)\)/.exec(u.text)[1];
    assert.ok(got(u).some((t) => t.kind === "head" && new RegExp(`(^|\\D)${n}(\\D|$)`).test(arDigits(t.text))), u.text);
  }
});
