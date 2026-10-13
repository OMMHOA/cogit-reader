import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getBook } from "@/lib/books";
import { loadThreads } from "@/lib/threads";
import { loadNotes } from "@/lib/notes";
import { sectionOf } from "@/lib/blocks";

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
  return (
    <div className="page">
      <h1>{book.title}</h1>
      <ol className="toc">
        {book.sections.map((s) => (
          <li key={s.index}>
            <Link href={`/k/${slug}/${s.index}`}>{s.index === 0 && s.title === book.title ? "Címlap" : s.title}</Link>
            {open.get(s.index) ? <span className="count">{open.get(s.index)} beszélgetés</span> : null}
            {notes.has(s.index) && <span className="count note">jegyzet</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
