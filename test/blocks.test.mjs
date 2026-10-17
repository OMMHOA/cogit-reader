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
  locateSection,
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

test("anchors survive a paragraph that grew or was joined with its neighbours", () => {
  const old = "„Menjetek előre, és legyetek jókedvűek! Allah megígérte nekem a két csapat egyikét.”¹²";
  const grown = parseBlocks(
    `Előtte.\n\n${old} [A két csapat: Abu Szufján karavánja és a kurejsita sereg, egyikük a muszlimok kezére kerül. – a ford.]\n\nUtána.\n`,
  );
  assert.equal(locateAnchor(grown, { blockIndex: 1, blockText: old, quote: null }), 1);
  const joined = parseBlocks(`Előtte.\n\nMegkérdezte tőlük: „Mire vártok?” ${old} Azután harcolt, míg el nem esett.\n\nUtána.\n`);
  assert.equal(locateAnchor(joined, { blockIndex: 2, blockText: old, quote: null }), 1);
  const gone = parseBlocks("Előtte.\n\nUtána egy egészen más bekezdés jön.\n");
  assert.equal(locateAnchor(gone, { blockIndex: 1, blockText: old, quote: null }), -1);
});

test("a chapter is found again by its title after chapters move", () => {
  const s = parseSections(parseBlocks("# A\n\nx\n\n# B\n\ny\n\n# C\n\nz\n"));
  assert.equal(locateSection(s, 1, "B"), 1);
  const moved = parseSections(parseBlocks("# Új\n\nw\n\n# A\n\nx\n\n# B\n\ny\n\n# C\n\nz\n"));
  assert.equal(locateSection(moved, 1, "B"), 2);
  assert.equal(locateSection(moved, 2, "Átnevezve"), 2); // title gone: the same place
  assert.equal(locateSection(s, 9, "Nincs"), 2);
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

  // Every 9th paragraph changed the ways the books get changed (on the site or in git): its
  // thread must stay with it, and a deleted paragraph's thread must rarely land elsewhere.
  test(`real book: anchors follow changed paragraphs: ${f}`, () => {
    const blocks = parseBlocks(readFileSync(new URL(f, BOOKS), "utf8"));
    const found = { grew: 0, joined: 0, split: 0, reworded: 0, deletedElsewhere: 0 };
    let n = 0;
    for (let i = 1; i < blocks.length - 1; i += 9) {
      const t = blocks[i].text;
      if (t.startsWith("#") || (t.match(/[\p{L}\p{N}]+/gu) ?? []).length < 5) continue;
      n++;
      // Replace `count` blocks from `from` by `texts` in place, locate, put them back. In place
      // keeps the word rarities computed for the whole book (one paragraph off: no matter).
      const at = (from, count, ...texts) => {
        const removed = blocks.splice(from, count, ...texts.map((x) => ({ index: from, start: 0, end: 0, text: x })));
        const r = locateAnchor(blocks, { blockIndex: i, blockText: t, quote: null });
        blocks.splice(from, texts.length, ...removed);
        return r;
      };
      const [prev, next] = [blocks[i - 1].text, blocks[i + 1].text];
      const ws = t.split(" ");
      const half = Math.ceil(ws.length / 2);
      if (at(i, 1, `${t} ${next}`) === i) found.grew++;
      if (at(i - 1, 3, `${prev} ${t} ${next}`) === i - 1) found.joined++;
      const s = at(i, 1, ws.slice(0, half).join(" "), ws.slice(half).join(" "));
      if (s === i || s === i + 1) found.split++;
      if (at(i, 1, ws.map((w, k) => (k % 4 === 1 ? `xq${k}` : w)).join(" ")) === i) found.reworded++;
      if (at(i, 1) !== -1) found.deletedElsewhere++;
    }
    const pct = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, Math.round((1000 * v) / n) / 10]));
    console.log(f, n, "paragraphs, % found:", pct);
    assert.ok(pct.grew >= 98 && pct.joined >= 98, "grew/joined");
    assert.ok(pct.split >= 85 && pct.reworded >= 92, "split/reworded");
    assert.ok(pct.deletedElsewhere <= 4, "deleted");
  });
}
