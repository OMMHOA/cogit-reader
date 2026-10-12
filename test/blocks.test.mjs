import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  parseBlocks,
  parseSections,
  checkEdit,
  normalizeEdit,
  applyEdit,
  locateAnchor,
  wordDiff,
} from "../lib/blocks.ts";

// The books repo, checked out next to this one.
const BOOKS = new URL("../../islamic-books-hun/", import.meta.url);
const FILES = [
  "fiqh-us-seerah/FiqhusSeerah-Muhammad-al-Ghazali-HUN-full.md",
  "muslim-home/MuslimHome-Muhammad-Salih-al-Munajjid-HUN.md",
].filter((f) => existsSync(new URL(f, BOOKS)));

test("blocks are runs of non-blank lines, offsets exact", () => {
  const src = "# A\n\nfirst line\nsecond line\n\n\n- x\n- y\n";
  const b = parseBlocks(src);
  assert.deepEqual(
    b.map((x) => x.text),
    ["# A", "first line\nsecond line", "- x\n- y"],
  );
  for (const x of b) assert.equal(src.slice(x.start, x.end), x.text);
});

test("sections: shallowest repeated heading level, heading-only runs merged", () => {
  const src = "# Book\n\nby\n\n# Előszó\n\ntext\n\n# Első fejezet\n# Üzenet\n\n## Sub\n\nbody\n\n# Második fejezet\n\n# A címe\n\nmore\n";
  const s = parseSections(parseBlocks(src));
  assert.deepEqual(
    s.map((x) => x.title),
    ["Book", "Előszó", "Első fejezet – Üzenet", "Második fejezet – A címe"],
  );
  const one = parseSections(parseBlocks("# Title\n\nx\n\n## Part 1\n\ny\n\n### (1) item\n\nz\n\n## Part 2\n\nw\n"));
  assert.deepEqual(one.map((x) => x.title), ["Title", "Part 1", "Part 2"]);
});

test("checkEdit guards structure and footnote markers", () => {
  assert.equal(checkEdit("Egy szép mondat¹.", "Egy szebb mondat¹."), null);
  assert.match(checkEdit("Egy mondat¹.", "Egy mondat."), /lábjegyzet/);
  assert.match(checkEdit("## Cím", "Cím"), /jelölés/);
  assert.match(checkEdit("- a\n- b", "- a"), /sorok száma/);
  assert.match(checkEdit("x", "x"), /Nincs változás/);
  assert.match(checkEdit("x", "  "), /üres/);
  assert.equal(checkEdit("*dőlt sor*", "*dőltebb sor*"), null);
  assert.equal(normalizeEdit("  a  \r\n\r\n b \n"), "a\n b");
});

test("applyEdit: same index, moved block, ambiguous and vanished blocks", () => {
  const src = "A\n\nB\n\nA\n\nC\n";
  assert.equal(applyEdit(src, 2, "A", "A2")?.text, "A\n\nB\n\nA2\n\nC\n");
  assert.equal(applyEdit(src, 3, "C", "C2")?.text, "A\n\nB\n\nA\n\nC2\n");
  assert.equal(applyEdit(src, 0, "B", "B2")?.text, "A\n\nB2\n\nA\n\nC\n"); // moved, unique
  assert.equal(applyEdit(src, 1, "A", "A2"), null); // index changed and text ambiguous
  assert.equal(applyEdit(src, 1, "Z", "Z2"), null);
});

test("anchors survive edits and moves", () => {
  const blocks = parseBlocks("Első bekezdés itt.\n\nA második bekezdés hosszabb szöveggel, sok szóval.\n\nHarmadik.\n");
  assert.equal(locateAnchor(blocks, { blockIndex: 1, blockText: blocks[1].text, quote: null }), 1);
  assert.equal(locateAnchor(blocks, { blockIndex: 0, blockText: "Harmadik.", quote: null }), 2);
  assert.equal(
    locateAnchor(blocks, { blockIndex: 1, blockText: "A második bekezdés hosszú szöveggel, sok szóval.", quote: null }),
    1,
  );
  assert.equal(locateAnchor(blocks, { blockIndex: 1, blockText: "egészen más", quote: "Első bekezdés" }), 0);
  assert.equal(locateAnchor(blocks, { blockIndex: 1, blockText: "egészen más", quote: null }), -1);
});

test("wordDiff", () => {
  const d = wordDiff("a nagy ház", "a kis ház");
  assert.deepEqual(d, [
    { kind: "same", text: "a " },
    { kind: "del", text: "nagy" },
    { kind: "ins", text: "kis" },
    { kind: "same", text: " ház" },
  ]);
});

for (const f of FILES) {
  test(`real book is lossless: ${f}`, () => {
    const src = readFileSync(new URL(f, BOOKS), "utf8");
    const blocks = parseBlocks(src);
    // Every non-blank byte belongs to exactly one block, in order.
    let rebuilt = "";
    let pos = 0;
    for (const b of blocks) {
      assert.match(src.slice(pos, b.start), /^\s*$/);
      rebuilt += src.slice(pos, b.end);
      pos = b.end;
    }
    rebuilt += src.slice(pos);
    assert.equal(rebuilt, src);
    // Each section starts with a heading block, and they tile the book.
    const sections = parseSections(blocks);
    assert.ok(sections.length > 5);
    assert.equal(sections[0].first, 0);
    assert.equal(sections.at(-1).last, blocks.length - 1);
    for (let i = 1; i < sections.length; i++) assert.equal(sections[i].first, sections[i - 1].last + 1);
    // Editing every 50th block changes that block only.
    for (let i = 0; i < blocks.length; i += 50) {
      const b = blocks[i];
      const r = applyEdit(src, i, b.text, b.text + " X");
      if (blocks.filter((x) => x.text === b.text).length > 1 && r === null) continue;
      assert.ok(r, `block ${i}`);
      assert.equal(r.text, src.slice(0, b.end) + " X" + src.slice(b.end));
    }
    console.log(f, blocks.length, "blocks;", sections.map((s) => s.title).join(" | "));
  });
}
