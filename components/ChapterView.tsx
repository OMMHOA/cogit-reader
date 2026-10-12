"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEdit, addComment } from "@/app/actions";
import type { BlockView } from "@/lib/render";
import type { Thread } from "@/lib/threads";
import ThreadView from "./ThreadView";

type Mode = { index: number; kind: "menu" | "edit" | "comment"; quote: string | null } | null;

export default function ChapterView({
  slug,
  blocks,
  threads,
  orphans,
}: {
  slug: string;
  blocks: BlockView[];
  threads: Thread[];
  orphans: Thread[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ index: number; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const pick = (e: React.MouseEvent<HTMLDivElement>, b: BlockView) => {
    if ((e.target as HTMLElement).closest("a, button, textarea, .thread, .thread-collapsed, .tools")) return;
    if (mode && mode.index === b.index && mode.kind !== "menu") return;
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, " ").trim() : "";
    const inside = !!text && !!sel?.anchorNode && e.currentTarget.contains(sel.anchorNode);
    if (mode?.index === b.index && !inside) return setMode(null);
    setError(null);
    setSaved(null);
    setMode({ index: b.index, kind: "menu", quote: inside ? text.slice(0, 1000) : null });
  };

  const open = (b: BlockView, kind: "edit" | "comment") => {
    setDraft(kind === "edit" ? b.text : "");
    setError(null);
    setMode((m) => ({ index: b.index, kind, quote: m?.quote ?? null }));
  };

  const submit = (b: BlockView) =>
    start(async () => {
      const r =
        mode?.kind === "edit"
          ? await saveEdit({ slug, blockIndex: b.index, oldText: b.text, newText: draft })
          : await addComment({ slug, blockIndex: b.index, blockText: b.text, quote: mode?.quote ?? null, body: draft });
      if (r.error) return setError(r.error);
      setSaved({
        index: b.index,
        text: mode?.kind === "edit" ? "Elmentve, köszönjük!" : "Elküldve. A válasz itt és a Kérdések oldalon jelenik meg.",
      });
      setMode(null);
      router.refresh();
    });

  const byBlock = new Map<number, Thread[]>();
  for (const t of threads) byBlock.set(t.blockIndex, [...(byBlock.get(t.blockIndex) ?? []), t]);

  return (
    <div className="chapter">
      {orphans.length > 0 && (
        <section className="orphans">
          <h2>Megváltozott bekezdésekhez tartozó beszélgetések</h2>
          <p className="muted">Ezek a bekezdések azóta megváltoztak, ezért a beszélgetés itt látszik.</p>
          {orphans.map((t) => (
            <div key={t.id}>
              <blockquote className="was">{t.blockText}</blockquote>
              <ThreadView thread={t} />
            </div>
          ))}
        </section>
      )}
      {blocks.map((b) => {
        const active = mode?.index === b.index;
        const editing = active && mode.kind === "edit";
        return (
          <div
            key={b.index}
            id={`p-${b.index}`}
            className={`blk${active ? " active" : ""}${b.editable ? "" : " fixed"}`}
            onClick={b.editable ? (e) => pick(e, b) : undefined}
          >
            {editing ? (
              <div className="tools">
                <textarea
                  className="edit"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(24, Math.max(4, Math.ceil(draft.length / 60) + draft.split("\n").length))}
                  autoFocus
                />
                <p className="hint">
                  A <code>*csillagok közötti*</code> szöveg dőlt, a <code>**dupla csillagok közötti**</code> félkövér. A sor
                  eleji jelekhez (<code>#</code>, <code>-</code>, <code>1.</code>) és a lábjegyzetszámokhoz (¹ ²) ne nyúlj.
                </p>
                {error && <p className="error">{error}</p>}
                <div className="buttons">
                  <button className="primary" disabled={pending} onClick={() => submit(b)}>
                    {pending ? "Mentés…" : "Mentés"}
                  </button>
                  <button disabled={pending} onClick={() => setMode(null)}>
                    Mégse
                  </button>
                </div>
              </div>
            ) : (
              <div className="md" dangerouslySetInnerHTML={{ __html: b.html }} />
            )}
            {saved?.index === b.index && <p className="saved">{saved.text}</p>}
            {active && mode.kind === "menu" && (
              <div className="tools buttons">
                <button onClick={() => open(b, "edit")}>Javítás</button>
                <button onClick={() => open(b, "comment")}>
                  {mode.quote ? "Kérdés a kijelölt szövegről" : "Kérdés vagy megjegyzés"}
                </button>
                <button className="link" onClick={() => setMode(null)}>
                  Bezárás
                </button>
                {!mode.quote && <span className="muted small">Tipp: jelölj ki szavakat, ha azokról kérdezel.</span>}
              </div>
            )}
            {active && mode.kind === "comment" && (
              <div className="tools form">
                {mode.quote && <p className="quote">{mode.quote}</p>}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                  placeholder="Mit kérdeznél, vagy mit javasolsz?"
                  autoFocus
                />
                {error && <p className="error">{error}</p>}
                <div className="buttons">
                  <button className="primary" disabled={pending || !draft.trim()} onClick={() => submit(b)}>
                    {pending ? "Küldés…" : "Küldés"}
                  </button>
                  <button disabled={pending} onClick={() => setMode(null)}>
                    Mégse
                  </button>
                </div>
              </div>
            )}
            {(byBlock.get(b.index) ?? []).map((t) => (
              <ThreadView key={t.id} thread={t} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
