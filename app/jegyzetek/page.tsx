import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listBooks, sectionName } from "@/lib/books";
import { loadAllNotes, type Note } from "@/lib/notes";
import { formatDate } from "@/lib/threads";
import { sectionOf } from "@/lib/blocks";

export const metadata: Metadata = { title: "Jegyzeteim" };

// One note in the list: its chapter, the paragraph it is on (null for the chapter's own) and
// where on the chapter page it is.
type Item = { sec: number; at: number; text: string | null; lost: boolean; note: Note };

// The signed-in member's own notes, book by book in reading order, each a link to where it is.
export default async function Notes() {
  const me = await requireMember();
  const books = await listBooks();
  const all = await loadAllNotes(books, me.id);
  return (
    <div className="page">
      <h1>Saját jegyzeteim</h1>
      <p className="muted">
        Csak te látod őket: sem a többi lektor, sem Claude nem olvassa. Egy fejezethez a fejezet sarkában lévő{" "}
        <b>Jegyzet</b> gombbal írhatsz, egy bekezdéshez a bekezdésre kattintva.
      </p>
      {all.length === 0 && <p className="muted">Még nincs jegyzeted.</p>}
      {all.map(({ book, notes }) => {
        const items: Item[] = [
          ...[...notes.chapters].map(([sec, note]) => ({ sec, at: -1, text: null, lost: false, note })),
          ...[...notes.paragraphs].map(([at, note]) => ({
            sec: sectionOf(book.sections, at),
            at,
            text: book.blocks[at].text,
            lost: false,
            note,
          })),
          ...notes.lost.map((l) => ({ sec: l.section, at: l.hintIndex, text: l.blockText, lost: true, note: l.note })),
        ].sort((a, b) => a.sec - b.sec || a.at - b.at);
        return (
          <section key={book.slug}>
            <h2>{book.title}</h2>
            {items.map((i) => (
              <article key={i.note.ids[0]} className="note-item">
                <div className="where">
                  <Link href={`/k/${book.slug}/${i.sec}${i.text && !i.lost ? `#p-${i.at}` : ""}`}>
                    {sectionName(book, book.sections[i.sec])}
                  </Link>
                  {!i.text && " · a fejezethez"}
                  {i.lost && " · a bekezdés azóta megváltozott"} · {formatDate(i.note.at)}
                </div>
                {i.text && <blockquote className="was">{i.text.length > 300 ? i.text.slice(0, 300) + "…" : i.text}</blockquote>}
                <div className="note-body">{i.note.body}</div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
