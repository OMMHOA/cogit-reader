import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { listBooks } from "@/lib/books";
import { formatDate } from "@/lib/threads";
import { locateAnchor, sectionOf } from "@/lib/blocks";
import type { EditStatus } from "@/lib/edits";
import { Diff, EditChip } from "@/components/EditDiff";

export const metadata: Metadata = { title: "Javítások" };

type Edit = {
  id: string;
  created_at: string;
  path: string;
  block_index: number;
  old_text: string;
  new_text: string;
  author_name: string;
  status: EditStatus;
  note: string | null;
};

export default async function Edits() {
  await requireMember();
  const sb = await supabase();
  const { data } = await sb
    .from("edits")
    .select("id, created_at, path, block_index, old_text, new_text, author_name, status, note")
    .order("created_at", { ascending: false })
    .limit(300);
  const edits = (data ?? []) as Edit[];
  const books = await listBooks();
  return (
    <div className="page">
      <h1>Javítások</h1>
      <p className="muted">
        Minden javítás azonnal bekerül a könyvbe. Claude utána átnézi: a „Rendben” jelűek maradnak, a visszaállítottaknál
        megírja, miért.
      </p>
      {edits.length === 0 && <p className="muted">Még nincs javítás.</p>}
      {edits.map((e) => {
        const book = books.find((b) => b.path === e.path);
        const now = book ? locateAnchor(book.blocks, { blockIndex: e.block_index, blockText: e.new_text, quote: null }) : -1;
        const s = book?.sections[sectionOf(book.sections, now === -1 ? e.block_index : now)];
        return (
          <article key={e.id} className="edit-item">
            <div className="meta">
              <EditChip status={e.status} /> <b>{e.author_name}</b> · {formatDate(e.created_at)}
              {book && s && (
                <>
                  {" · "}
                  <Link href={`/k/${book.slug}/${s.index}${now === -1 ? "" : `#p-${now}`}`}>
                    {book.title} › {s.title}
                  </Link>
                </>
              )}
            </div>
            <Diff before={e.old_text} after={e.new_text} />
            {e.note && (
              <p className="note">
                <b>Claude:</b> {e.note}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
