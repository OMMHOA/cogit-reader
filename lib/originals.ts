import "server-only";
import { blobText } from "./github";
import { align, type Alignment } from "./align";
import { renderText } from "./render";
import type { Book, Lang } from "./books";

// The English or Arabic text next to the Hungarian, paragraph by paragraph (lib/align.ts).
// Matching a whole book takes a few hundred milliseconds, so it is kept per pair of file
// versions; a proofreader's edit makes a new Hungarian version, matched again on first use.

const cache = new Map<string, Promise<Alignment>>();

function alignment(book: Book, lang: Lang): Promise<Alignment> | null {
  const other = book.versions[lang];
  if (!other) return null;
  const key = `${book.sha}:${other.sha}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = blobText(other.sha).then((src) => align(book.src, src));
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

export type OriginalUnit = { i: number; html: string; page: string | null; note: boolean };

export type Original = {
  units: OriginalUnit[]; // the section's matched paragraphs and a few around them, in order
  map: Record<number, number[]>; // Hungarian block index → unit indices (`i`)
  start: number; // where the section starts in the other version, for paragraphs with no match
};

const AROUND = 6;

export async function loadOriginal(book: Book, sec: number, lang: Lang): Promise<Original | null> {
  const s = book.sections[sec];
  const pending = alignment(book, lang);
  if (!s || !pending) return null;
  const { units, map } = await pending;
  // After the last text (not footnote) matched before the section.
  let start = 0;
  for (let b = s.first - 1; b >= 0 && !start; b--) {
    const text = (map.get(b) ?? []).filter((j) => units[j].kind !== "note");
    if (text.length) start = Math.max(...text) + 1;
  }
  const out: Record<number, number[]> = {};
  let lo = start;
  let hi = start;
  for (let b = s.first; b <= s.last; b++) {
    out[b] = map.get(b) ?? [];
    for (const j of out[b]) {
      lo = Math.min(lo, j);
      hi = Math.max(hi, j);
    }
  }
  return {
    units: units.slice(Math.max(0, lo - AROUND), hi + AROUND + 1).map((u) => ({
      i: u.index,
      html: renderText(u.text),
      page: u.page,
      note: u.kind === "note",
    })),
    map: out,
    start,
  };
}
