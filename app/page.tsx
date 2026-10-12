import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listBooks } from "@/lib/books";
import { loadThreads } from "@/lib/threads";

export default async function Home() {
  await requireMember();
  const books = await listBooks();
  const threads = await loadThreads(books);
  return (
    <div className="page">
      <h1>Könyvek</h1>
      <ul className="books">
        {books.map((b) => {
          const waiting = threads.filter((t) => t.path === b.path && t.status === "open").length;
          return (
            <li key={b.slug}>
              <Link href={`/k/${b.slug}`}>{b.title}</Link>
              <span className="muted">
                {b.sections.length} rész{waiting > 0 && ` · ${waiting} kérdés válaszra vár`}
              </span>
            </li>
          );
        })}
      </ul>

      <section className="help">
        <h2>Hogyan működik?</h2>
        <ol>
          <li>
            Nyiss meg egy könyvet, és kattints egy bekezdésre. Két lehetőséged van: <b>Javítás</b> vagy{" "}
            <b>Kérdés vagy megjegyzés</b>.
          </li>
          <li>
            A <b>javítás</b> azonnal bekerül a könyvbe. Elütésekhez, vesszőkhöz, egy-egy jobb szóhoz való. Claude később
            minden javítást átnéz; ha valamit vissza kell állítani, a bekezdés alatt megírja, miért.
          </li>
          <li>
            <b>Kérdést</b> akkor írj, ha nem vagy biztos a dolgodban, vagy ha tudni szeretnéd, miért áll ott, ami ott áll.
            Ha előbb kijelölsz néhány szót, a kérdés azokhoz kapcsolódik. Claude válaszol; a válasz a bekezdés alatt és a{" "}
            <Link href="/kerdesek">Kérdések</Link> oldalon jelenik meg.
          </li>
        </ol>
        <p>
          <b>Ezeket ne javítsd, inkább kérdezz rá:</b> a Korán-idézetek szövegét (szó szerint az MME-fordításból valók), a
          nevek írásmódját (egységes átírási szabályt követnek), a tiszteletformulákat, mint a (ﷺ), és a szerző
          kemény megfogalmazásait (a fordítás nem tompít rajtuk).
        </p>
      </section>
    </div>
  );
}
