// Lines up the Hungarian translation with another version of the same book (the English or the
// Arabic) paragraph by paragraph, so a proofreader can see what a paragraph renders. Nothing in
// the files marks the correspondence, so it is computed: headings first, level by level (by where
// they fall and how long their part is), then the paragraphs between two matched headings by
// length, Gale–Church style, helped by footnote markers, numbers and Qur'ān quotes. Footnotes
// follow their markers. Pure (Node runs it directly, like blocks.ts).

import { parseBlocks, headingLevel } from "./blocks.ts";

export type Unit = {
  index: number;
  block: number; // the block of the file it comes from
  text: string; // Markdown
  kind: "head" | "body" | "sep" | "note";
  level: number; // heading level (head)
  page: string | null; // the printed page it is on, from the [صفحة N] markers
  note: number | null; // footnote number (note)
  cont: boolean; // a further paragraph of the footnote before it
  markers: number[]; // footnote markers in the text
  nums: string[]; // other numbers of two or more digits
  quran: boolean; // quotes the Qur'ān
  len: number;
};

const PAGE = /^\[صفحة\s+([^\]]+)\]$/;
const NOTES_HEAD = /^#{1,6}\s+(Footnotes|Lábjegyzetek)\s*$/;
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUP_RUN = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
const AR_MARK = /\(([٠-٩]+)\)/g; // the Arabic edition's footnote markers: (١)
const SEP = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QURAN = /\(Korán\s|\(Qur.ān\s|﴿/;

const arDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const supNum = (s: string) => Number([...s].map((c) => SUP.indexOf(c)).join(""));

function unit(index: number, block: number, text: string, page: string | null, kind: Unit["kind"]): Unit {
  const markers =
    kind === "body"
      ? [...(text.match(SUP_RUN) ?? []).map(supNum), ...[...text.matchAll(AR_MARK)].map((m) => Number(arDigits(m[1])))]
      : [];
  const nums = kind === "sep" ? [] : arDigits(text.replace(SUP_RUN, " ").replace(AR_MARK, " ")).match(/\d{2,}/g) ?? [];
  return {
    index,
    block,
    text,
    kind,
    level: kind === "head" ? headingLevel(text) : 0,
    page,
    note: null,
    cont: false,
    markers,
    nums: [...new Set(nums)],
    quran: QURAN.test(text),
    len: text.length,
  };
}

// A file's paragraphs as units. Page markers (also when they share a block with the text
// around them), HTML comments and footnote headings are dropped (a unit remembers its page);
// footnotes become note units, one per note: the paragraphs under a footnote heading (¹ …),
// and the Arabic edition's per-page blockquotes ((١) …; unnumbered ones, * …, too).
export function toUnits(src: string): Unit[] {
  const out: Unit[] = [];
  let page: string | null = null;
  let inNotes = false;
  let lastNote: number | null = null;
  const add = (block: number, lines: string[]) => {
    const text = lines.join("\n");
    if (/^<!--[\s\S]*-->$/.test(text.trim())) return;
    if (lines.every((l) => headingLevel(l) > 0)) {
      inNotes = NOTES_HEAD.test(lines[0]);
      if (!inNotes) out.push(unit(out.length, block, text, page, "head"));
      return;
    }
    const quoted = lines.every((l) => l.startsWith(">"));
    if (SEP.test(text)) inNotes = false;
    if (!quoted && !inNotes) {
      out.push(unit(out.length, block, text, page, SEP.test(text) ? "sep" : "body"));
      return;
    }
    let cur: string[] = [];
    let cont = true;
    const flush = () => {
      if (!cur.length) return;
      const u = unit(out.length, block, cur.join("\n"), page, "note");
      u.note = lastNote;
      u.cont = cont;
      out.push(u);
    };
    for (const raw of lines) {
      const l = quoted ? raw.replace(/^>\s?/, "") : raw;
      if (!l.trim()) continue;
      const m = quoted ? /^\(([٠-٩]+)\)/.exec(l) : /^[⁰¹²³⁴⁵⁶⁷⁸⁹]+/.exec(l);
      if (m || (quoted && /^(\*|\((\*|٭)\))/.test(l))) {
        flush();
        cur = [];
        cont = false;
        lastNote = !m ? null : quoted ? Number(arDigits(m[1])) : supNum(m[0]);
      }
      cur.push(l);
    }
    flush();
  };
  for (const b of parseBlocks(src)) {
    let run: string[] = [];
    for (const line of b.text.split("\n")) {
      const pm = PAGE.exec(line.trim());
      if (!pm) {
        run.push(line);
        continue;
      }
      if (run.length) add(b.index, run);
      run = [];
      page = pm[1];
      inNotes = false; // a footnote heading of the Arabic edition labels one page's notes
    }
    if (run.length) add(b.index, run);
  }
  return out;
}

// --- Alignment -----------------------------------------------------------------------------

type Bead = { h: number[]; t: number[]; gone?: boolean }; // gone: text the other version lacks

// pre[i], npre[i]: text length and count of numbers of the non-note units before i
type Side = { units: Unit[]; pre: Float64Array; npre: Float64Array };

function side(units: Unit[]): Side {
  const pre = new Float64Array(units.length + 1);
  const npre = new Float64Array(units.length + 1);
  units.forEach((u, i) => {
    pre[i + 1] = pre[i] + (u.kind === "note" ? 0 : u.len);
    npre[i + 1] = npre[i] + (u.kind === "note" ? 0 : u.nums.length);
  });
  return { units, pre, npre };
}

function overlap(a: string[], b: string[]): number {
  let n = 0;
  for (const x of a) if (b.includes(x)) n++;
  return n;
}

// Cost of pairing Hungarian units H[i0..i1) with the other version's T[j0..j1) (lower is
// better). Runs in the innermost loop, so it walks the ranges instead of building arrays.
function beadCost(H: Unit[], i0: number, i1: number, T: Unit[], j0: number, j1: number, ratio: number): number {
  let lh = 0, mh = 0, nh = 0, hSep = false, hHead = false, qh = false, inner = false;
  for (let i = i0; i < i1; i++) {
    const u = H[i];
    lh += u.len;
    mh += u.markers.length;
    nh += u.nums.length;
    hSep ||= u.kind === "sep";
    hHead ||= u.kind === "head";
    inner ||= i > i0 && u.kind === "head";
    qh ||= u.quran;
  }
  let lt = 0, mt = 0, nt = 0, tSep = false, tHead = false, qt = false;
  for (let j = j0; j < j1; j++) {
    const u = T[j];
    lt += u.len;
    mt += u.markers.length;
    nt += u.nums.length;
    tSep ||= u.kind === "sep";
    tHead ||= u.kind === "head";
    inner ||= j > j0 && u.kind === "head";
    qt ||= u.quran;
  }
  if (hSep || tSep) return i1 - i0 === 1 && j1 - j0 === 1 && hSep && tSep ? -1 : 6;
  let c = 3 * Math.abs(Math.log((lt * ratio + 30) / (lh + 30)));
  if (hHead !== tHead) c += 2.5; // a heading matched with plain text
  if (inner) c += 3; // a heading starts what it is matched with
  if (mh || mt) {
    if (mh !== mt) c += 1.5 * Math.abs(mh - mt);
    else {
      const a = H.slice(i0, i1).flatMap((u) => u.markers).join();
      c -= Math.min(4, 1.5 * mh) + (a === T.slice(j0, j1).flatMap((u) => u.markers).join() ? 2 : 0);
    }
  }
  if (nh && nt) c -= Math.min(3, overlap(H.slice(i0, i1).flatMap((u) => u.nums), T.slice(j0, j1).flatMap((u) => u.nums)));
  else if (Math.max(nh, nt) >= 3) c += 1.5; // numbers on one side only: e.g. a table of contents
  if (qh && qt) c -= 1;
  else if (qh || qt) c += 1;
  return c;
}

const skipCost = (u: Unit) => (u.kind === "sep" ? 0.5 : 1.5 + 0.4 * Math.log(1 + u.len / 40));

const MOVES: [number, number, number][] = [
  [1, 1, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 2, 0.6],
  [2, 1, 0.6],
  [1, 3, 1.4],
  [3, 1, 1.4],
];

// Paragraphs between two matched headings: a dynamic program over the two runs.
function alignRun(H: Unit[], T: Unit[], ratio: number): Bead[] {
  const n = H.length;
  const m = T.length;
  if (!n || !m) return [...H.map((u) => ({ h: [u.index], t: [] })), ...T.map((u) => ({ h: [], t: [u.index] }))];
  if (n * m > 4_000_000) {
    // Far too long to compare (no headings to anchor on): by relative position.
    return H.map((u, i) => ({ h: [u.index], t: [T[Math.min(m - 1, Math.floor((i / n) * m))].index] }));
  }
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Infinity);
  const back = new Uint8Array((n + 1) * W);
  cost[0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const here = cost[i * W + j];
      if (here === Infinity) continue;
      for (let k = 0; k < MOVES.length; k++) {
        const [di, dj, pen] = MOVES[k];
        const i2 = i + di;
        const j2 = j + dj;
        if (i2 > n || j2 > m) continue;
        const c =
          here +
          pen +
          (di === 0 ? skipCost(T[j]) : dj === 0 ? skipCost(H[i]) : beadCost(H, i, i2, T, j, j2, ratio));
        if (c < cost[i2 * W + j2]) {
          cost[i2 * W + j2] = c;
          back[i2 * W + j2] = k;
        }
      }
    }
  const beads: Bead[] = [];
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const [di, dj] = MOVES[back[i * W + j]];
    beads.push({ h: H.slice(i - di, i).map((u) => u.index), t: T.slice(j - dj, j).map((u) => u.index) });
    i -= di;
    j -= dj;
  }
  return beads.reverse();
}

// Headings of one level in two stretches, matched in order: close in relative position, and
// their parts of similar length (by the overall length ratio); matching numbers help.
function matchHeads(hs: Side, ha: number, hb: number, H: Unit[], ts: Side, ta: number, tb: number, T: Unit[], ratio: number) {
  const pos = (s: Side, a: number, b: number, i: number) => (s.pre[i] - s.pre[a]) / Math.max(1, s.pre[b] - s.pre[a]);
  // A heading's part: its text length, and how many numbers it has per thousand characters.
  const span = (s: Side, b: number, u: Unit, scale: number) => {
    let k = u.index + 1;
    while (k < b && !(s.units[k].kind === "head" && s.units[k].level <= u.level)) k++;
    const len = (s.pre[k] - s.pre[u.index]) * scale;
    return { len, dense: ((s.npre[k] - s.npre[u.index]) * 1000) / Math.max(1, len) };
  };
  const SKIP = 2.5;
  const n = H.length;
  const m = T.length;
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Infinity);
  const back = new Uint8Array((n + 1) * W);
  cost[0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const here = cost[i * W + j];
      if (here === Infinity) continue;
      const step = (i2: number, j2: number, c: number, k: number) => {
        if (i2 <= n && j2 <= m && here + c < cost[i2 * W + j2]) {
          cost[i2 * W + j2] = here + c;
          back[i2 * W + j2] = k;
        }
      };
      step(i + 1, j, SKIP, 1);
      step(i, j + 1, SKIP, 2);
      if (i < n && j < m) {
        const h = H[i];
        const t = T[j];
        const sh = span(hs, hb, h, 1);
        const st = span(ts, tb, t, ratio);
        const c =
          20 * Math.abs(pos(hs, ha, hb, h.index) - pos(ts, ta, tb, t.index)) +
          2 * Math.abs(Math.log((st.len + 200) / (sh.len + 200))) +
          2 * Math.abs(Math.log((st.dense + 1) / (sh.dense + 1))) -
          (overlap(h.text.match(/\d+/g) ?? [], arDigits(t.text).match(/\d+/g) ?? []) ? 2 : 0);
        step(i + 1, j + 1, c, 0);
      }
    }
  const pairs: [number, number][] = [];
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const k = back[i * W + j];
    if (k === 0) pairs.push([H[--i].index, T[--j].index]);
    else if (k === 1) i--;
    else j--;
  }
  return pairs.reverse();
}

// What the recursion carries: both sides, the length ratio (Hungarian ÷ other), and what to do
// with the stretches between matched headings once no heading level is left.
type Ctx = {
  hs: Side;
  ts: Side;
  ratio: number;
  out: Bead[];
  leaf: (ha: number, hb: number, ta: number, tb: number) => void;
};

const pick = (s: Side, a: number, b: number) => s.units.slice(a, b).filter((u) => u.kind !== "note");

function alignStretch(c: Ctx, ha: number, hb: number, ta: number, tb: number, level: number) {
  const { hs, ts, ratio, out } = c;
  if (level > 6) return c.leaf(ha, hb, ta, tb);
  const H = pick(hs, ha, hb).filter((u) => u.kind === "head" && u.level === level);
  const T = pick(ts, ta, tb).filter((u) => u.kind === "head" && u.level === level);
  const pairs = H.length && T.length ? matchHeads(hs, ha, hb, H, ts, ta, tb, T, ratio) : [];
  let h0 = ha;
  let t0 = ta;
  const between = (h1: number, t1: number) => {
    // Headings of this level left unmatched here: either the other version has their text
    // without the heading, or not at all (a glossary only the translation has). The lengths
    // tell which; text it doesn't have is left out of the matching.
    const firstHead = (s: Side, a: number, b: number) => {
      for (let i = a; i < b; i++) if (s.units[i].kind === "head" && s.units[i].level === level) return i;
      return b;
    };
    const hc = firstHead(hs, h0, h1);
    const tc = firstHead(ts, t0, t1);
    const fit = (he: number, te: number) =>
      Math.abs(Math.log(((ts.pre[te] - ts.pre[t0]) * ratio + 300) / (hs.pre[he] - hs.pre[h0] + 300)));
    let best = { he: h1, te: t1, f: fit(h1, t1) };
    for (const [he, te] of [[hc, t1], [h1, tc], [hc, tc]])
      if ((he !== h1 || te !== t1) && fit(he, te) + 0.1 < best.f) best = { he, te, f: fit(he, te) };
    alignStretch(c, h0, best.he, t0, best.te, level + 1);
    for (const u of pick(hs, best.he, h1)) out.push({ h: [u.index], t: [], gone: true });
    for (const u of pick(ts, best.te, t1)) out.push({ h: [], t: [u.index], gone: true });
  };
  for (const [h, t] of pairs) {
    between(h, t);
    out.push({ h: [h], t: [t] });
    h0 = h + 1;
    t0 = t + 1;
  }
  between(hb, tb);
}

// How much longer the Hungarian is than the other version. Not simply the totals: text only one
// side has (a glossary) would skew it, so it is the length-weighted median over the stretches
// between matched headings, which such text doesn't sway.
function lengthRatio(hs: Side, ts: Side): number {
  const total = hs.pre[hs.units.length] / Math.max(1, ts.pre[ts.units.length]);
  const parts: [number, number][] = [];
  const leaf = (ha: number, hb: number, ta: number, tb: number) => {
    const h = hs.pre[hb] - hs.pre[ha];
    const t = ts.pre[tb] - ts.pre[ta];
    if (h > 0 && t > 0) parts.push([h, h / t]);
  };
  alignStretch({ hs, ts, ratio: total, out: [], leaf }, 0, hs.units.length, 0, ts.units.length, 1);
  if (parts.length < 3) return total;
  parts.sort((a, b) => a[1] - b[1]);
  let seen = 0;
  const half = parts.reduce((n, [h]) => n + h, 0) / 2;
  for (const [h, r] of parts) if ((seen += h) >= half) return r;
  return total;
}

export type Alignment = {
  units: Unit[]; // the other version's units
  map: Map<number, number[]>; // Hungarian block index → the other version's unit indices
};

export function align(hunSrc: string, otherSrc: string): Alignment {
  const hs = side(toUnits(hunSrc));
  const ts = side(toUnits(otherSrc));
  const ratio = lengthRatio(hs, ts);
  const beads: Bead[] = [];
  const leaf = (ha: number, hb: number, ta: number, tb: number) =>
    beads.push(...alignRun(pick(hs, ha, hb), pick(ts, ta, tb), ratio));
  alignStretch({ hs, ts, ratio, out: beads, leaf }, 0, hs.units.length, 0, ts.units.length, 1);

  // Every paragraph of the other version belongs somewhere (except text the translation
  // lacks): one the matching left out goes with the Hungarian paragraph before it (or, at the
  // very start, after it).
  const owner = new Map<number, Bead>(); // other unit → bead
  for (const b of beads) for (const t of b.t) owner.set(t, b);
  let prev: Bead | null = null;
  const orphans: number[] = [];
  for (const u of ts.units) {
    const b = owner.get(u.index);
    if (u.kind === "note" || b?.gone) continue;
    if (b?.h.length) {
      b.t.push(...orphans.splice(0));
      prev = b;
    } else if (prev) prev.t.push(u.index);
    else orphans.push(u.index);
  }

  // A Hungarian paragraph left without a match continues the one before it (the translation
  // splits long paragraphs, e.g. at Qur'ān quotes); a heading goes with the heading after it.
  const kindOf = (b: Bead) => hs.units[b.h[0]]?.kind;
  for (let k = beads.length - 2; k >= 0; k--) {
    const [b, next] = [beads[k], beads[k + 1]];
    if (!b.t.length && !b.gone && kindOf(b) === "head" && next.t.length && kindOf(next) === "head") {
      next.h.unshift(...b.h);
      b.h = [];
    }
  }
  prev = null;
  for (const b of beads) {
    if (b.h.length && b.t.length) prev = b;
    else if (prev && !b.gone && kindOf(b) === "body") {
      prev.h.push(...b.h);
      b.h = [];
    }
  }

  const hunOf = new Map<number, number[]>(); // Hungarian unit → other units
  for (const b of beads) for (const h of b.h) hunOf.set(h, b.t.sort((x, y) => x - y));

  // Footnotes: a note's marker is in some Hungarian paragraph; the same marker (by its place
  // among the markers) in the matched paragraphs of the other version leads to its note.
  const beadOf = new Map<number, Bead>();
  for (const b of beads) for (const h of b.h) beadOf.set(h, b);
  const lastMarker = new Map<number, number>();
  let lastNoteUnits: number[] = [];
  for (const u of hs.units) {
    if (u.kind !== "note") {
      for (const m of u.markers) lastMarker.set(m, u.index);
      continue;
    }
    if (u.cont) {
      hunOf.set(u.index, lastNoteUnits);
      continue;
    }
    lastNoteUnits = [];
    hunOf.set(u.index, lastNoteUnits);
    const at = u.note === null ? undefined : lastMarker.get(u.note);
    const bead = at === undefined ? undefined : beadOf.get(at);
    if (!bead || at === undefined) continue;
    const hm: [number, number][] = bead.h.flatMap((i) => hs.units[i].markers.map((m) => [i, m] as [number, number]));
    const tm: [number, number][] = bead.t.flatMap((i) => ts.units[i].markers.map((m) => [i, m] as [number, number]));
    const k = hm.findIndex(([i, m]) => i === at && m === u.note);
    if (k < 0 || !tm.length) continue;
    const [ti, tn] = tm[Math.min(k, tm.length - 1)];
    // Its note is the next one with that number, unless the number is used for a marker again
    // first (the next chapter's or page's): then the other version doesn't have this note.
    for (let j = ti + 1; j < ts.units.length; j++) {
      const t = ts.units[j];
      if (t.kind !== "note" && t.markers.includes(tn)) break;
      if (t.kind !== "note" || t.note !== tn || t.cont) continue;
      lastNoteUnits.push(j);
      for (let c = j + 1; c < ts.units.length && ts.units[c].kind === "note" && ts.units[c].cont; c++) lastNoteUnits.push(c);
      break;
    }
  }

  const map = new Map<number, number[]>();
  for (const u of hs.units) map.set(u.block, [...new Set([...(map.get(u.block) ?? []), ...(hunOf.get(u.index) ?? [])])]);
  return { units: ts.units, map };
}
