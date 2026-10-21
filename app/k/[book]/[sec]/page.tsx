import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getBook, sectionName } from "@/lib/books";
import { loadThreads } from "@/lib/threads";
import { loadEdits } from "@/lib/edits";
import { loadNotes } from "@/lib/notes";
import { renderBlocks } from "@/lib/render";
import { sectionOf } from "@/lib/blocks";
import ChapterView from "@/components/ChapterView";
import { ChapterNote } from "@/components/Notes";

type Params = Promise<{ book: string; sec: string }>;

async function chapter(params: Params) {
  const { book: slug, sec } = await params;
  const book = await getBook(slug);
  const s = /^\d+$/.test(sec) ? book?.sections[Number(sec)] : undefined;
  return book && s ? { book, s } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await chapter(params);
  return found ? { title: `${sectionName(found.book, found.s)} – ${found.book.title}` } : {};
}

export default async function SectionPage({ params }: { params: Params }) {
  const me = await requireMember();
  const found = await chapter(params);
  if (!found) notFound();
  const { book, s } = found;
  const slug = book.slug;
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
      <ChapterNote key={`${slug}/${s.index}`} slug={slug} sec={s.index} title={s.title} note={notes.chapters.get(s.index) ?? null} />
      <ChapterView
        slug={slug}
        sec={s.index}
        title={s.title}
        version={book.sha}
        langs={(["en", "ar"] as const).filter((l) => book.versions[l])}
        blocks={renderBlocks(book.blocks.slice(s.first, s.last + 1))}
        threads={here}
        orphans={orphans}
        edits={edits.filter((e) => e.blockIndex >= s.first && e.blockIndex <= s.last)}
        notes={[...notes.paragraphs]
          .filter(([i]) => i >= s.first && i <= s.last)
          .map(([blockIndex, note]) => ({ blockIndex, note }))}
        lostNotes={notes.lost.filter((l) => l.section === s.index)}
      />
      {pager}
    </div>
  );
}
