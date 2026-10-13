"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/books";
import type { Original, OriginalUnit } from "@/lib/originals";

// The English or Arabic text next to the Hungarian (lib/originals.ts): fetched per section and
// language when first asked for, shown under one paragraph or beside every paragraph.

export const LANG_TITLE: Record<Lang, string> = { en: "Angol", ar: "Arab" };

type Loaded = Original | "loading" | { error: string };

// `version` is the Hungarian file's: after it changes the matching is fetched again.
export function useOriginals(slug: string, sec: number, version: string, wanted: (Lang | null)[]) {
  const [got, setGot] = useState<Record<string, Loaded>>({});
  const key = (lang: Lang) => `${slug}/${sec}@${version}:${lang}`;
  const need = wanted.filter((l): l is Lang => !!l && !got[key(l)]);
  useEffect(() => {
    for (const lang of need) {
      const k = key(lang);
      setGot((g) => ({ ...g, [k]: "loading" }));
      fetch(`/k/${encodeURIComponent(slug)}/${sec}/eredeti?nyelv=${lang}`)
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || body.error) throw new Error(body?.error || "Nem sikerült betölteni, próbáld újra.");
          return body as Original;
        })
        .then(
          (data) => setGot((g) => ({ ...g, [k]: data })),
          (e: Error) => setGot((g) => ({ ...g, [k]: { error: e.message } })),
        );
    }
  }, [need.join(), slug, sec, version]);
  return {
    get: (lang: Lang) => got[key(lang)],
    retry: (lang: Lang) =>
      setGot((g) => {
        const { [key(lang)]: _, ...rest } = g;
        return rest;
      }),
  };
}

export function Status({ state, onRetry }: { state: Loaded | undefined; onRetry: () => void }) {
  if (!state || state === "loading") return <span className="muted small">Betöltés…</span>;
  if ("error" in state)
    return (
      <span className="error small">
        {state.error}{" "}
        <button className="link" onClick={onRetry}>
          Újra
        </button>
      </span>
    );
  return null;
}

const pages = (us: OriginalUnit[]) => {
  const ps = us.map((u) => u.page).filter((p): p is string => !!p);
  if (!ps.length) return "";
  return ps[0] === ps[ps.length - 1] ? `${ps[0]}. oldal` : `${ps[0]}–${ps[ps.length - 1]}. oldal`;
};

// The other version's text for each paragraph of the section, each of its paragraphs once (two
// Hungarian paragraphs may render one), with the page where a new one starts.
export function columns(data: Original, blocks: number[]) {
  const byI = new Map(data.units.map((u) => [u.i, u]));
  const seen = new Set<number>();
  const out = new Map<number, { unit: OriginalUnit; page: string | null }[]>();
  let page: string | null = null;
  for (const b of blocks) {
    const list: { unit: OriginalUnit; page: string | null }[] = [];
    for (const i of data.map[b] ?? []) {
      const unit = byI.get(i);
      if (!unit || seen.has(i)) continue;
      seen.add(i);
      list.push({ unit, page: unit.page !== page ? unit.page : null });
      page = unit.page;
    }
    out.set(b, list);
  }
  return out;
}

export function Column({ lang, list }: { lang: Lang; list: { unit: OriginalUnit; page: string | null }[] }) {
  return (
    <div className={list.length ? "par-col" : "par-col none"}>
      <div className="par-text" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
        {list.map(({ unit, page }) => (
          <div key={unit.i} className={unit.note ? "note-unit" : undefined}>
            {page && (
              <div className="page-no">
                <bdi>{page}. oldal</bdi>
              </div>
            )}
            <div dangerouslySetInnerHTML={{ __html: unit.html }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// One paragraph's counterpart, with the paragraphs around it a click away: the matching is
// computed, so now and then it is a paragraph off.
export function Peek({
  lang,
  state,
  block,
  first,
  onRetry,
  onClose,
}: {
  lang: Lang;
  state: Loaded | undefined;
  block: number;
  first: number; // the section's first block
  onRetry: () => void;
  onClose: () => void;
}) {
  const [more, setMore] = useState({ before: 0, after: 0 });
  const head = (extra?: React.ReactNode) => (
    <div className="par-head">
      <b>{LANG_TITLE[lang]} szöveg</b>
      {extra}
      <button className="link close" onClick={onClose} aria-label="Bezárás">
        ×
      </button>
    </div>
  );
  if (!state || state === "loading" || "error" in state)
    return (
      <div className="par">
        {head(<Status state={state} onRetry={onRetry} />)}
      </div>
    );

  const byI = new Map(state.units.map((u) => [u.i, u]));
  let got = state.map[block] ?? [];
  let note = byI.get(got[0])?.note ?? false;
  let from = Math.min(...got);
  let to = Math.max(...got);
  if (!got.length) {
    // No match of its own: show where it would be, after what the paragraphs before it matched.
    from = state.start;
    for (let b = block - 1; b >= first; b--) {
      const g = state.map[b];
      if (!g?.length) continue;
      from = Math.max(...g) + 1;
      note = byI.get(g[0])?.note ?? false;
      break;
    }
    to = from - 1;
    got = [];
  }
  const seq = state.units.filter((u) => u.note === note);
  let lo = seq.findIndex((u) => u.i >= from);
  if (lo < 0) lo = seq.length;
  const hi = seq.findLastIndex((u) => u.i <= to);
  const a = Math.max(0, lo - more.before);
  const z = Math.min(seq.length - 1, Math.max(hi, lo - 1) + more.after);
  const shown = seq.slice(a, z + 1);
  const matched = shown.filter((u) => got.includes(u.i));
  return (
    <div className="par">
      {head(
        <>
          <span className="muted">{pages(matched.length ? matched : shown)}</span>
          <span className="par-nav">
            <button className="link" disabled={a === 0} onClick={() => setMore((m) => ({ ...m, before: m.before + 1 }))}>
              ‹ előtte
            </button>
            <button
              className="link"
              disabled={z >= seq.length - 1}
              onClick={() => setMore((m) => ({ ...m, after: m.after + 1 }))}
            >
              utána ›
            </button>
          </span>
        </>,
      )}
      {!got.length && !shown.length && <p className="muted small">Ennek a résznek nincs megfelelője.</p>}
      {!got.length && shown.length > 0 && (
        <p className="muted small">Ennek a résznek nincs külön megfelelője; ez áll körülötte:</p>
      )}
      <div className="par-text" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
        {shown.map((u) => (
          <div
            key={u.i}
            className={got.includes(u.i) ? undefined : "ctx"}
            dangerouslySetInnerHTML={{ __html: u.html }}
          />
        ))}
      </div>
    </div>
  );
}
