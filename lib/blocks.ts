// Pure text logic shared by the site, the scripts and the tests (no imports, so Node runs it
// directly). A book is a Markdown file; a block is a run of non-blank lines (a paragraph, a
// heading, a list, a footnote); edits replace one block by its offsets, so every other byte of
// the file stays exactly as it was.

export type Block = { index: number; start: number; end: number; text: string };

export type Section = {
  index: number;
  title: string;
  first: number; // first block index
  last: number; // last block index (inclusive)
};

const BLANK = /^[ \t]*$/;

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let start = -1;
  let end = -1;
  let pos = 0;
  while (pos <= src.length) {
    const nl = src.indexOf("\n", pos);
    const lineEnd = nl === -1 ? src.length : nl;
    const line = src.slice(pos, lineEnd);
    if (BLANK.test(line)) {
      if (start !== -1) {
        blocks.push({ index: blocks.length, start, end, text: src.slice(start, end) });
        start = -1;
      }
    } else {
      if (start === -1) start = pos;
      end = lineEnd;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (start !== -1) blocks.push({ index: blocks.length, start, end, text: src.slice(start, end) });
  return blocks;
}

export function headingLevel(line: string): number {
  const m = /^(#{1,6})\s/.exec(line);
  return m ? m[1].length : 0;
}

export function headingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

// Sections are the reading units (chapters): the shallowest heading level that occurs at least
// twice splits the book. A section made only of headings so far absorbs the next heading, so
// "# Első fejezet" + "# Üzenet és egy vezető" stay together.
export function parseSections(blocks: Block[]): Section[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const b of blocks) for (const line of b.text.split("\n")) counts[headingLevel(line)]++;
  let level = 1;
  while (level < 6 && counts[level] < 2) level++;

  const isSplit = (b: Block) => {
    const l = headingLevel(b.text);
    return l > 0 && l <= level;
  };
  const isHeadingOnly = (b: Block) => b.text.split("\n").every((line) => headingLevel(line) > 0);

  const sections: Section[] = [];
  let cur: { first: number; headingsOnly: boolean } | null = null;
  const close = (last: number) => {
    if (!cur) return;
    // The title: the split-level headings at the top of the section.
    const heads: string[] = [];
    for (let i = cur.first; i <= last; i++) {
      for (const line of blocks[i].text.split("\n")) {
        const l = headingLevel(line);
        if (l > 0 && l <= level) heads.push(headingText(line));
      }
      if (!isHeadingOnly(blocks[i])) break;
    }
    sections.push({ index: sections.length, title: heads.join(" – ") || "Bevezető", first: cur.first, last });
  };
  for (const b of blocks) {
    if (cur && isSplit(b) && !cur.headingsOnly) {
      close(b.index - 1);
      cur = null;
    }
    if (!cur) cur = { first: b.index, headingsOnly: true };
    if (!isHeadingOnly(b)) cur.headingsOnly = false;
  }
  if (cur) close(blocks.length - 1);
  return sections;
}

export function sectionOf(sections: Section[], blockIndex: number): number {
  for (const s of sections) if (blockIndex >= s.first && blockIndex <= s.last) return s.index;
  return sections.length ? sections[sections.length - 1].index : 0;
}

// Where a chapter kept by index and title (a personal note's) is now: the same place if its
// title is unchanged there, else the nearest chapter with that title, else the same place.
export function locateSection(sections: Section[], index: number, title: string): number {
  if (sections[index]?.title === title) return index;
  const same = sections.filter((s) => s.title === title);
  if (same.length)
    return same.reduce((best, s) => (Math.abs(s.index - index) < Math.abs(best.index - index) ? s : best)).index;
  return Math.max(0, Math.min(index, sections.length - 1));
}

// --- Edits -------------------------------------------------------------------------------

const MARKERS = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
const PREFIX = /^(\s*)(#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>\s?)?/;

export function footnoteMarkers(text: string): string[] {
  return text.match(MARKERS) ?? [];
}

// What the edit box hands in: no CRs, no trailing spaces, no blank lines (a blank line would
// split the paragraph in two), no leading/trailing blank space.
export function normalizeEdit(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0)
    .join("\n")
    .replace(/^\s+/, "");
}

export const MAX_BLOCK = 20000;

// Returns a Hungarian error message, or null when the edit may be saved.
export function checkEdit(oldText: string, newText: string): string | null {
  if (!newText.trim()) return "A bekezdés nem lehet üres. Ha törölni kellene, írd meg megjegyzésben.";
  if (newText === oldText) return "Nincs változás.";
  if (newText.length > MAX_BLOCK) return "A szöveg túl hosszú.";
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  if (oldLines.length !== newLines.length)
    return "A sorok száma nem változhat. Ha a bekezdést szét kellene bontani vagy össze kellene vonni, írd meg megjegyzésben.";
  for (let i = 0; i < oldLines.length; i++) {
    const a = PREFIX.exec(oldLines[i])![0];
    const b = PREFIX.exec(newLines[i])![0];
    if (a !== b)
      return `A(z) ${i + 1}. sor elején a jelölés (${a.trim() || "nincs"}) nem változhat: ez adja meg, hogy cím, felsorolás vagy sima szöveg.`;
  }
  if (footnoteMarkers(oldText).join(",") !== footnoteMarkers(newText).join(","))
    return "A lábjegyzetszámok (¹ ² ³…) nem változhatnak. Ha egy lábjegyzettel gond van, írd meg megjegyzésben.";
  return null;
}

// Finds the block the editor saw: at the same index if unchanged there, otherwise the one block
// with the same text. Null when it has changed or is ambiguous.
export function locateBlock(blocks: Block[], index: number, text: string): Block | null {
  if (blocks[index]?.text === text) return blocks[index];
  const same = blocks.filter((b) => b.text === text);
  return same.length === 1 ? same[0] : null;
}

export function applyEdit(
  src: string,
  index: number,
  oldText: string,
  newText: string,
): { text: string; index: number } | null {
  const block = locateBlock(parseBlocks(src), index, oldText);
  if (!block) return null;
  return { text: src.slice(0, block.start) + newText + src.slice(block.end), index: block.index };
}

// --- Comment anchors ---------------------------------------------------------------------

export type Anchor = { blockIndex: number; blockText: string; quote: string | null };

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

const blockWords = new WeakMap<Block, Set<string>>();
function wordsOf(b: Block): Set<string> {
  let w = blockWords.get(b);
  if (!w) blockWords.set(b, (w = words(b.text)));
  return w;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

// How rare each word is in the book (log((N+1)/(df+1))), so "a", "és", "hogy" barely count.
// Computed once per parsed book.
const rarityCache = new WeakMap<Block[], (w: string) => number>();
function rarity(blocks: Block[]): (w: string) => number {
  let r = rarityCache.get(blocks);
  if (!r) {
    const df = new Map<string, number>();
    for (const b of blocks) for (const w of wordsOf(b)) df.set(w, (df.get(w) ?? 0) + 1);
    r = (w) => Math.log((blocks.length + 1) / ((df.get(w) ?? 0) + 1));
    rarityCache.set(blocks, r);
  }
  return r;
}

// Share of the old paragraph's words (weighted by rarity) still in b: high when a paragraph
// grew or was joined with its neighbours, which similarity() scores low.
function containment(a: Set<string>, b: Set<string>, rare: (w: string) => number): number {
  let all = 0;
  let kept = 0;
  for (const w of a) {
    const r = rare(w);
    all += r;
    if (b.has(w)) kept += r;
  }
  return all ? kept / all : 0;
}

function nearest(cands: Block[], index: number): Block {
  return cands.reduce((best, b) => (Math.abs(b.index - index) < Math.abs(best.index - index) ? b : best));
}

// Where a comment belongs now: its paragraph unchanged; else the paragraph holding its quoted
// words; else the best match near its old place (a later edit: most words the same, or most
// of the old words still there after it grew or was joined); else -1. The thresholds are
// measured on the real books (test/blocks.test.mjs).
export function locateAnchor(blocks: Block[], a: Anchor): number {
  if (blocks[a.blockIndex]?.text === a.blockText) return a.blockIndex;
  const same = blocks.filter((b) => b.text === a.blockText);
  if (same.length) return nearest(same, a.blockIndex).index;
  if (a.quote && a.quote.trim().length >= 8) {
    const q = a.quote.trim();
    const hits = blocks.filter((b) => b.text.includes(q));
    if (hits.length) return nearest(hits, a.blockIndex).index;
  }
  const target = words(a.blockText);
  const rare = rarity(blocks);
  let best = -1;
  let bestScore = 0;
  const from = Math.max(0, a.blockIndex - 60);
  const to = Math.min(blocks.length - 1, a.blockIndex + 60);
  for (let i = from; i <= to; i++) {
    const b = wordsOf(blocks[i]);
    const j = similarity(target, b);
    const c = containment(target, b, rare);
    const s = Math.max(j > 0.5 ? j : 0, c >= 0.8 ? c : 0);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

// --- Word diff (for the list of edits) -----------------------------------------------------

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

export function wordDiff(a: string, b: string): DiffPart[] {
  const x = a.match(/\s+|[^\s]+/g) ?? [];
  const y = b.match(/\s+|[^\s]+/g) ?? [];
  const n = x.length;
  const m = y.length;
  if (n * m > 4_000_000) return [{ kind: "del", text: a }, { kind: "ins", text: b }];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push("same", x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("ins", y[j++]);
  return out;
}
