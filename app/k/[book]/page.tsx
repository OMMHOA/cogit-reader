import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getBook } from "@/lib/books";
import { loadThreads } from "@/lib/threads";
import { sectionOf } from "@/lib/blocks";

export default async function BookPage({ params }: { params: Promise<{ book: string }> }) {
  await requireMember();
  const { book: slug } = await params;
  const book = await getBook(slug);
  if (!book) notFound();
  const threads = await loadThreads([book], book.path);
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
          </li>
        ))}
      </ol>
    </div>
  );
}
