"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEdit, addComment } from "@/app/actions";
import type { BlockView } from "@/lib/render";
import type { Thread } from "@/lib/threads";
import type { EditMark } from "@/lib/edits";
import type { Note } from "@/lib/notes";
import type { Lang } from "@/lib/books";
import ThreadView from "./ThreadView";
import { Column, LANG_TITLE, Peek, Status, columns, useOriginals } from "./Original";
import { Diff, EditChip } from "./EditDiff";
import { ParagraphNote } from "./Notes";

type Mode = { index: number; kind: "menu" | "edit" | "comment"; quote: string | null } | null;

const SIDE = "parhuzamos"; // the chosen parallel text, remembered in the browser

export default function ChapterView({
  slug,
  sec,
  title,
  version,
  langs,
  blocks,
  threads,
  orphans,
  edits,
  notes,
  lostNotes,
}: {
  slug: string;
  sec: number;
  title: string;
  version: string; // of the Hungarian file
  langs: Lang[]; // the book's other versions
  blocks: BlockView[];
  threads: Thread[];
  orphans: Thread[];
  edits: EditMark[]; // made on the site, on this section's paragraphs
  notes: { blockIndex: number; note: Note }[]; // the reader's own, on this section's paragraphs
  lostNotes: { hintIndex: number; blockText: string; note: Note }[]; // on paragraphs not found any more
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ index: number; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  // The English or Arabic text: beside every paragraph (side), or under one (peek).
  const [side, setSide] = useState<Lang | null>(null);
  const [peek, setPeek] = useState<{ index: number; lang: Lang } | null>(null);
  // The paragraph whose edits are shown as word diffs.
  const [changes, setChanges] = useState<number | null>(null);
  // The paragraph note being written ("p<block>", or "l<id>" for a lost paragraph's), and the
  // paragraphs whose note was opened here: those stay mounted, so a new note stays on the page.
  const [noteAt, setNoteAt] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const originals = useOriginals(slug, sec, version, [side, peek?.lang ?? null]);

  useEffect(() => {
    try {
      const l = localStorage.getItem(SIDE) as Lang | null;
      if (l && langs.includes(l)) setSide(l);
    } catch {}
  }, [langs.join()]);

  const toggleSide = (l: Lang) => {
    const next = side === l ? null : l;
    setSide(next);
    if (peek?.lang === next) setPeek(null);
    try {
      if (next) localStorage.setItem(SIDE, next);
      else localStorage.removeItem(SIDE);
    } catch {}
  };

  const pick = (e: React.MouseEvent<HTMLDivElement>, b: BlockView) => {
    if ((e.target as HTMLElement).closest("a, button, textarea, .thread, .thread-collapsed, .tools, .par, .par-col, .changes, .pnote")) return;
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
  const notesOf = new Map(notes.map((n) => [n.blockIndex, n.note]));
  const writeNote = (b: BlockView) => {
    setOpened((o) => new Set(o).add(b.index));
    setNoteAt(`p${b.index}`);
    setMode(null);
  };
  const editsOf = new Map<number, EditMark[]>();
  for (const e of edits) editsOf.set(e.blockIndex, [...(editsOf.get(e.blockIndex) ?? []), e]);
  // Who edited a paragraph, as classes for its change bar: by-me, by-others or both.
  const editedBy = (list: EditMark[] | undefined) =>
    list
      ? ` edited${list.some((e) => e.mine) ? " by-me" : ""}${list.some((e) => !e.mine) ? " by-others" : ""}`
      : "";

  const sideData = side ? originals.get(side) : undefined;
  const cols =
    side && sideData && sideData !== "loading" && !("error" in sideData)
      ? columns(
          sideData,
          blocks.map((b) => b.index),
        )
      : null;

  return (
    <div className={`chapter${side ? " two" : ""}`}>
      {(langs.length > 0 || edits.length > 0) && (
        <div className="chapter-bar">
          {langs.length > 0 && (
            <div className="par-switch">
              <span className="muted">Párhuzamos szöveg:</span>
              {langs.map((l) => (
                <button key={l} className={side === l ? "on" : undefined} aria-pressed={side === l} onClick={() => toggleSide(l)}>
                  {LANG_TITLE[l]}
                </button>
              ))}
              {side && !cols && <Status state={sideData} onRetry={() => originals.retry(side)} />}
            </div>
          )}
          {edits.length > 0 && (
            <p className="legend muted">
              Javított bekezdés:
              {edits.some((e) => e.mine) && <span className="key by-me">te javítottad</span>}
              {edits.some((e) => !e.mine) && <span className="key by-others">más javította</span>}
            </p>
          )}
        </div>
      )}
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
      {lostNotes.length > 0 && (
        <section className="orphans">
          <h2>Saját jegyzetek megváltozott bekezdésekhez</h2>
          <p className="muted">Ezek a bekezdések azóta annyira megváltoztak, hogy nem találjuk őket, ezért a jegyzeted itt látszik.</p>
          {lostNotes.map((l) => (
            <div key={l.note.ids[0]}>
              <blockquote className="was">{l.blockText}</blockquote>
              <ParagraphNote
                slug={slug}
                sec={sec}
                title={title}
                blockIndex={l.hintIndex}
                blockText={l.blockText}
                note={l.note}
                editing={noteAt === `l${l.note.ids[0]}`}
                onEdit={() => setNoteAt(`l${l.note.ids[0]}`)}
                onDone={() => setNoteAt(null)}
              />
            </div>
          ))}
        </section>
      )}
      {blocks.map((b) => {
        const active = mode?.index === b.index;
        const editing = active && mode.kind === "edit";
        const blockEdits = editsOf.get(b.index);
        return (
          <div
            key={b.index}
            id={`p-${b.index}`}
            className={`blk${active ? " active" : ""}${b.editable ? "" : " fixed"}${cols ? " two" : ""}${editedBy(blockEdits)}`}
            onClick={b.editable ? (e) => pick(e, b) : undefined}
          >
            <div className="hu">
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
              {(notesOf.has(b.index) || opened.has(b.index)) && (
                // Keyed by the text: when the paragraph changes, the note is the server's again,
                // anchored to the new text.
                <ParagraphNote
                  key={b.text}
                  slug={slug}
                  sec={sec}
                  title={title}
                  blockIndex={b.index}
                  blockText={b.text}
                  note={notesOf.get(b.index) ?? null}
                  editing={noteAt === `p${b.index}`}
                  onEdit={() => setNoteAt(`p${b.index}`)}
                  onDone={() => setNoteAt(null)}
                />
              )}
              {peek?.index === b.index && (
                <Peek
                  key={`${peek.index}:${peek.lang}`}
                  lang={peek.lang}
                  state={originals.get(peek.lang)}
                  block={b.index}
                  first={blocks[0]?.index ?? 0}
                  onRetry={() => originals.retry(peek.lang)}
                  onClose={() => setPeek(null)}
                />
              )}
              {changes === b.index && blockEdits && (
                <div className="changes">
                  <div className="par-head">
                    <b>Javítások ezen a bekezdésen</b>
                    <button className="link close" onClick={() => setChanges(null)} aria-label="Bezárás">
                      ×
                    </button>
                  </div>
                  {blockEdits.map((e) => (
                    <div key={e.id} className={`change${e.mine ? " by-me" : " by-others"}`}>
                      <div className="meta">
                        <b>{e.mine ? "Te" : e.author}</b> · {e.at} <EditChip status={e.status} />
                      </div>
                      <Diff before={e.oldText} after={e.newText} />
                    </div>
                  ))}
                </div>
              )}
              {saved?.index === b.index && <p className="saved">{saved.text}</p>}
              {active && mode.kind === "menu" && (
                <div className="tools buttons">
                  <button onClick={() => open(b, "edit")}>Javítás</button>
                  <button onClick={() => open(b, "comment")}>
                    {mode.quote ? "Kérdés a kijelölt szövegről" : "Kérdés vagy megjegyzés"}
                  </button>
                  <button onClick={() => writeNote(b)}>Saját jegyzet</button>
                  {blockEdits && (
                    <button
                      aria-pressed={changes === b.index}
                      onClick={() => setChanges(changes === b.index ? null : b.index)}
                    >
                      Ki mit javított?
                    </button>
                  )}
                  {langs
                    .filter((l) => l !== side)
                    .map((l) => (
                      <button
                        key={l}
                        aria-pressed={peek?.index === b.index && peek.lang === l}
                        onClick={() => setPeek(peek?.index === b.index && peek.lang === l ? null : { index: b.index, lang: l })}
                      >
                        {LANG_TITLE[l]} szöveg
                      </button>
                    ))}
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
            {cols && side && <Column lang={side} list={cols.get(b.index) ?? []} />}
          </div>
        );
      })}
    </div>
  );
}
