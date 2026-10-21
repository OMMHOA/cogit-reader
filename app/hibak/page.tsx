import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listBooks } from "@/lib/books";
import { loadArabicErrors, type ArabicError, type View } from "@/lib/arabicErrors";
import { sectionOf } from "@/lib/blocks";
import ErrorDecision from "@/components/ErrorDecision";

export const metadata: Metadata = { title: "Az eredeti hibái" };

const TABS: { key: string; label: string; show: (e: ArabicError) => boolean }[] = [
  { key: "dontesre-var", label: "Döntésre vár", show: (e) => !e.decision && !e.applied },
  { key: "eldontve", label: "Eldöntve", show: (e) => !!e.decision && !e.applied },
  { key: "atvezetve", label: "Átvezetve", show: (e) => e.applied },
  { key: "mind", label: "Mind", show: () => true },
];

const GROUPS: { view: View; title: string }[] = [
  { view: "slip", title: "Claude szerint elírás" },
  { view: "fact", title: "Claude szerint nem elírás, hanem ténybeli tévedés" },
];

export default async function ArabicErrors({ searchParams }: { searchParams: Promise<{ lap?: string }> }) {
  await requireMember();
  const { lap } = await searchParams;
  const books = await listBooks();
  const all = await loadArabicErrors(books);
  const tab = TABS.find((t) => t.key === lap) ?? (all.some(TABS[0].show) ? TABS[0] : TABS[3]);
  const shown = all.filter(tab.show);
  return (
    <div className="page">
      <h1>Az arab eredeti hibái</h1>
      <p className="muted">
        Ha a szerző nyilvánvalóan elírt valamit (egy betűt egy névben, egy számjegyet), a fordítás megjegyzés nélkül a
        helyeset írja. Ha tényben téved (ki mondta, hol történt, ki kinek a rokona), a fordítás hű marad hozzá, és egy
        megjegyzés jelzi a hibát. Itt eldöntheted, melyik melyik; Claude a döntések szerint vezeti át őket a könyvön.
      </p>
      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/hibak?lap=${t.key}`} className={t === tab ? "on" : ""}>
            {t.label} ({all.filter(t.show).length})
          </Link>
        ))}
      </nav>
      {shown.length === 0 && <p className="muted">Itt most nincs semmi.</p>}
      {GROUPS.map((g) => {
        const items = shown.filter((e) => e.claudeView === g.view);
        if (!items.length) return null;
        return (
          <section key={g.view}>
            <h2>{g.title}</h2>
            {items.map((e) => {
              const book = books.find((b) => b.path === e.path);
              const s = book?.sections[sectionOf(book.sections, e.blockIndex === -1 ? e.hintIndex : e.blockIndex)];
              return (
                <article key={e.id} className="ar-error">
                  {book && s && (
                    <div className="where">
                      <Link href={`/k/${book.slug}/${s.index}${e.blockIndex === -1 ? "" : `#p-${e.blockIndex}`}`}>
                        {book.title} › {s.title}
                      </Link>
                    </div>
                  )}
                  <dl>
                    <dt>Az arab eredetiben</dt>
                    <dd lang="ar" dir="rtl" className="ar">
                      {e.arabic}
                    </dd>
                    <dt>A fordításban most</dt>
                    <dd className="book">{e.huNow}</dd>
                    <dt>Ha elírás, ez lesz belőle</dt>
                    <dd className="book">{e.huFix}</dd>
                    <dt>Indoklás</dt>
                    <dd>{e.reason}</dd>
                  </dl>
                  <ErrorDecision item={e} />
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
