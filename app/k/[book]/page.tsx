import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getBook, sectionName } from "@/lib/books";
import { loadThreads } from "@/lib/threads";
import { loadNotes } from "@/lib/notes";
import { sectionOf } from "@/lib/blocks";

export async function generateMetadata({ params }: { params: Promise<{ book: string }> }): Promise<Metadata> {
  const book = await getBook((await params).book);
  return book ? { title: book.title } : {};
}

export default async function BookPage({ params }: { params: Promise<{ book: string }> }) {
  const me = await requireMember();
  const { book: slug } = await params;
  const book = await getBook(slug);
  if (!book) notFound();
  const [threads, notes] = await Promise.all([loadThreads([book], book.path), loadNotes(book, me.id)]);
  const open = new Map<number, number>();
  for (const t of threads) {
    if (t.status === "resolved") continue;
    const s = sectionOf(book.sections, t.blockIndex === -1 ? t.hintIndex : t.blockIndex);
    open.set(s, (open.get(s) ?? 0) + 1);
  }
  // The reader's own notes, on the chapter and on its paragraphs.
  const noted = new Map<number, number>();
  const note = (s: number) => noted.set(s, (noted.get(s) ?? 0) + 1);
  for (const s of notes.chapters.keys()) note(s);
  for (const b of notes.paragraphs.keys()) note(sectionOf(book.sections, b));
  for (const l of notes.lost) note(l.section);
  return (
    <div className="page">
      <h1>{book.title}</h1>
      <ol className="toc">
        {book.sections.map((s) => (
          <li key={s.index}>
            <Link href={`/k/${slug}/${s.index}`}>{sectionName(book, s)}</Link>
            {open.get(s.index) ? <span className="count">{open.get(s.index)} beszélgetés</span> : null}
            {noted.get(s.index) ? <span className="count note">{noted.get(s.index)} jegyzet</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
