import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listBooks } from "@/lib/books";
import { loadThreads, type Status } from "@/lib/threads";
import { sectionOf } from "@/lib/blocks";
import ThreadView from "@/components/ThreadView";

const TABS: { key: string; label: string; show: Status[] }[] = [
  { key: "nyitott", label: "Válaszra vár", show: ["open"] },
  { key: "megvalaszolt", label: "Megválaszolt", show: ["answered"] },
  { key: "lezart", label: "Lezárt", show: ["resolved"] },
  { key: "mind", label: "Mind", show: ["open", "answered", "resolved"] },
];

export default async function Questions({ searchParams }: { searchParams: Promise<{ lap?: string }> }) {
  await requireMember();
  const { lap } = await searchParams;
  const tab = TABS.find((t) => t.key === lap) ?? TABS[3];
  const books = await listBooks();
  const threads = (await loadThreads(books)).filter((t) => tab.show.includes(t.status)).reverse();
  return (
    <div className="page">
      <h1>Kérdések és megjegyzések</h1>
      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/kerdesek?lap=${t.key}`} className={t === tab ? "on" : ""}>
            {t.label}
          </Link>
        ))}
      </nav>
      {threads.length === 0 && <p className="muted">Itt most nincs semmi.</p>}
      {threads.map((t) => {
        const book = books.find((b) => b.path === t.path);
        if (!book) return null;
        const s = book.sections[sectionOf(book.sections, t.blockIndex === -1 ? t.hintIndex : t.blockIndex)];
        const text = t.blockIndex === -1 ? t.blockText : book.blocks[t.blockIndex].text;
        return (
          <article key={t.id} className="qa">
            <div className="where">
              {book.title} › {s.title}
            </div>
            <blockquote className="was">{text.length > 300 ? text.slice(0, 300) + "…" : text}</blockquote>
            <ThreadView
              thread={t}
              link={`/k/${book.slug}/${s.index}${t.blockIndex === -1 ? "" : `#p-${t.blockIndex}`}`}
            />
          </article>
        );
      })}
    </div>
  );
}
