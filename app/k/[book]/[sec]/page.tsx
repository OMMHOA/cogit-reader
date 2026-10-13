import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getBook } from "@/lib/books";
import { loadThreads } from "@/lib/threads";
import { loadEdits } from "@/lib/edits";
import { loadNotes } from "@/lib/notes";
import { renderBlocks } from "@/lib/render";
import { sectionOf } from "@/lib/blocks";
import ChapterView from "@/components/ChapterView";
import ChapterNote from "@/components/ChapterNote";

export default async function SectionPage({ params }: { params: Promise<{ book: string; sec: string }> }) {
  const me = await requireMember();
  const { book: slug, sec } = await params;
  const book = await getBook(slug);
  const s = book?.sections[Number(sec)];
  if (!book || !s || !/^\d+$/.test(sec)) notFound();
  const [threads, edits, notes] = await Promise.all([
    loadThreads([book], book.path),
    loadEdits(book, me.id),
    loadNotes(book, me.id),
  ]);
  const here = threads.filter((t) => t.blockIndex >= s.first && t.blockIndex <= s.last);
  const orphans = threads.filter((t) => t.blockIndex === -1 && sectionOf(book.sections, t.hintIndex) === s.index);
  const prev = book.sections[s.index - 1];
  const next = book.sections[s.index + 1];
  const pager = (
    <nav className="pager">
      {prev ? <Link href={`/k/${slug}/${prev.index}`}>← {prev.title}</Link> : <span />}
      {next ? <Link href={`/k/${slug}/${next.index}`}>{next.title} →</Link> : <span />}
    </nav>
  );
  return (
    <div className="page reading">
      <nav className="crumbs">
        <Link href={`/k/${slug}`}>{book.title}</Link>
      </nav>
      <ChapterNote key={`${slug}/${s.index}`} slug={slug} sec={s.index} title={s.title} note={notes.get(s.index) ?? null} />
      <ChapterView
        slug={slug}
        sec={s.index}
        version={book.sha}
        langs={(["en", "ar"] as const).filter((l) => book.versions[l])}
        blocks={renderBlocks(book.blocks.slice(s.first, s.last + 1))}
        threads={here}
        orphans={orphans}
        edits={edits.filter((e) => e.blockIndex >= s.first && e.blockIndex <= s.last)}
      />
      {pager}
    </div>
  );
}
