"use client";

import { useEffect, useRef, useState } from "react";
import { saveNote } from "@/app/actions";
import type { Note } from "@/lib/notes";

type State = "idle" | "saving" | "saved" | { error: string };

// The proofreader's own note on the chapter: shown at the top of the chapter, written in a panel
// that the button in the corner opens from anywhere in it. It saves itself a moment after the
// typing stops, when the panel closes and when the chapter is left.
export default function ChapterNote({
  slug,
  sec,
  title,
  note,
}: {
  slug: string;
  sec: number;
  title: string;
  note: Note | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note?.body ?? "");
  const [state, setState] = useState<State>("idle");
  const ids = useRef(note?.ids ?? []);
  const saved = useRef(note?.body ?? "");
  const latest = useRef(draft);
  latest.current = draft;
  // One save at a time, each with the text as it is when its turn comes.
  const queue = useRef(Promise.resolve());

  const flush = () => {
    queue.current = queue.current.then(async () => {
      const body = latest.current.trim();
      if (body === saved.current) return;
      setState("saving");
      const r = await saveNote({ slug, sec, title, ids: ids.current, body }).catch(() => ({
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
    // Closing the tab before the save went through: the browser asks first.
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current.trim() !== saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      flush(); // leaving the chapter on the site
    };
  }, []);

  const close = () => {
    setOpen(false);
    flush();
  };

  const text = draft.trim();
  return (
    <>
      {text && (
        <aside className="note-card" onClick={() => setOpen(true)}>
          <div className="note-head">
            <b>Saját jegyzet</b>
            <span className="muted">csak te látod</span>
            <button className="link">Szerkesztés</button>
          </div>
          <div className="note-body">{text}</div>
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
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (typeof state === "object") setState("idle");
            }}
            rows={8}
            maxLength={20000}
            placeholder="Amit erről a fejezetről meg akarsz jegyezni magadnak…"
            autoFocus
          />
          <div className="note-foot">
            <span className="muted">Csak te látod: sem a többi lektor, sem Claude nem olvassa.</span>
            {typeof state === "object" ? (
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
            ) : null}
          </div>
        </section>
      ) : (
        <button className={`note-fab${text ? " has" : ""}`} onClick={() => setOpen(true)} aria-label="Saját jegyzet">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          Jegyzet
        </button>
      )}
    </>
  );
}
