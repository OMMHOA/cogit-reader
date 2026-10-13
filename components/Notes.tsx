"use client";

import { useEffect, useRef, useState } from "react";
import { saveNote } from "@/app/actions";
import type { Note } from "@/lib/notes";

// The proofreader's own notes (lib/notes.ts): one on the chapter, written in a panel that the
// button in the corner opens from anywhere in it, and one on any paragraph, written under it.

type SaveState = "idle" | "saving" | "saved" | { error: string };

// Where a note belongs: its chapter, and for a paragraph's note the paragraph as shown.
type Place = { slug: string; sec: number; title: string; blockIndex?: number; blockText?: string };

// A note's text, saved by itself a moment after the typing stops, on `flush` (when its editor
// closes) and when it leaves the page; one save at a time, each with the text as it is when its
// turn comes. Closing the tab before the text is saved makes the browser ask first.
function useNote(note: Note | null, place: Place) {
  const [draft, setDraft] = useState(note?.body ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const ids = useRef(note?.ids ?? []);
  const saved = useRef(note?.body ?? "");
  const latest = useRef(draft);
  latest.current = draft;
  const where = useRef(place);
  where.current = place;
  const queue = useRef(Promise.resolve());

  const flush = () => {
    queue.current = queue.current.then(async () => {
      const body = latest.current.trim();
      if (body === saved.current) return;
      setState("saving");
      const r = await saveNote({ ...where.current, ids: ids.current, body }).catch(() => ({
        error: "Nem sikerült menteni, nézd meg az internetkapcsolatot.",
        id: undefined,
      }));
      if (r.error) return setState({ error: r.error });
      ids.current = r.id ? [r.id] : [];
      saved.current = body;
      setState("saved");
    });
  };

  const dirty = draft.trim() !== saved.current;
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(flush, 800);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current.trim() !== saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      flush(); // leaving the chapter on the site
    };
  }, []);

  const edit = (text: string) => {
    setDraft(text);
    if (typeof state === "object") setState("idle");
  };
  const status =
    typeof state === "object" ? (
      <span className="error">
        {state.error}{" "}
        <button className="link" onClick={flush}>
          Újra
        </button>
      </span>
    ) : state === "saving" ? (
      <span className="muted">Mentés…</span>
    ) : state === "saved" && !dirty ? (
      <span className="saved-mark">Mentve</span>
    ) : null;
  return { text: draft.trim(), draft, edit, flush, status };
}

const PRIVATE = "Csak te látod: sem a többi lektor, sem Claude nem olvassa.";

const PenIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

// The chapter's note: at the top of the chapter while it has text, written in the corner panel.
export function ChapterNote({ slug, sec, title, note }: { slug: string; sec: number; title: string; note: Note | null }) {
  const [open, setOpen] = useState(false);
  const n = useNote(note, { slug, sec, title });
  const close = () => {
    setOpen(false);
    n.flush();
  };
  return (
    <>
      {n.text && (
        <aside className="note-card" onClick={() => setOpen(true)}>
          <div className="note-head">
            <b>Saját jegyzet</b>
            <span className="muted">csak te látod</span>
            <button className="link">Szerkesztés</button>
          </div>
          <div className="note-body">{n.text}</div>
        </aside>
      )}
      {open ? (
        <section
          className="note-panel"
          aria-label="Saját jegyzet"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="note-head">
            <b>Saját jegyzet</b>
            <span className="muted note-title">{title}</span>
            <button className="link close" onClick={close} aria-label="Bezárás">
              ×
            </button>
          </div>
          <textarea
            value={n.draft}
            onChange={(e) => n.edit(e.target.value)}
            rows={8}
            maxLength={20000}
            placeholder="Amit erről a fejezetről meg akarsz jegyezni magadnak…"
            autoFocus
          />
          <div className="note-foot">
            <span className="muted">{PRIVATE} Egy bekezdéshez is írhatsz: kattints rá.</span>
            {n.status}
          </div>
        </section>
      ) : (
        <button className={`note-fab${n.text ? " has" : ""}`} onClick={() => setOpen(true)} aria-label="Saját jegyzet">
          <PenIcon />
          Jegyzet
        </button>
      )}
    </>
  );
}

// A paragraph's note, under it: shown while it has text, written in place when `editing`.
export function ParagraphNote({
  slug,
  sec,
  title,
  blockIndex,
  blockText,
  note,
  editing,
  onEdit,
  onDone,
}: Place & {
  blockIndex: number;
  blockText: string;
  note: Note | null;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const n = useNote(note, { slug, sec, title, blockIndex, blockText });
  const done = () => {
    onDone();
    n.flush();
  };
  if (!editing && !n.text) return null;
  return (
    <div className={`pnote${editing ? " editing" : ""}`} onClick={editing ? undefined : onEdit}>
      <div className="note-head">
        <PenIcon />
        <b>Saját jegyzet</b>
        <span className="muted">csak te látod</span>
        {editing ? (
          <button className="link" onClick={done}>
            Kész
          </button>
        ) : (
          <button className="link">Szerkesztés</button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            value={n.draft}
            onChange={(e) => n.edit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") done();
            }}
            rows={3}
            maxLength={20000}
            placeholder="Amit erről a bekezdésről meg akarsz jegyezni magadnak…"
            autoFocus
          />
          <div className="note-foot">
            <span className="muted">{PRIVATE}</span>
            {n.status}
          </div>
        </>
      ) : (
        <div className="note-body">{n.text}</div>
      )}
    </div>
  );
}
