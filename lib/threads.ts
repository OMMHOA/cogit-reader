import "server-only";
import { supabase } from "./supabase";
import { locateAnchor } from "./blocks";
import type { Book } from "./books";

export type Status = "open" | "answered" | "resolved";
export type Msg = { id: string; body: string; author: string; isClaude: boolean; at: string };
export type Thread = {
  id: string;
  path: string;
  blockIndex: number; // where the paragraph is now; -1 when it can't be found any more
  hintIndex: number; // where it was when the thread was started
  blockText: string; // the paragraph when the thread was started
  quote: string | null;
  status: Status;
  messages: Msg[];
};

type Row = {
  id: string;
  created_at: string;
  path: string;
  parent_id: string | null;
  block_index: number | null;
  block_text: string | null;
  quote: string | null;
  body: string;
  author_name: string;
  is_claude: boolean;
  status: Status;
};

const when = new Intl.DateTimeFormat("hu-HU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Budapest",
});
export const formatDate = (iso: string) => when.format(new Date(iso));

// Threads of one book (newest last), each placed on the paragraph it belongs to now.
export async function loadThreads(books: Book[], path?: string): Promise<Thread[]> {
  const sb = await supabase();
  let q = sb
    .from("comments")
    .select("id, created_at, path, parent_id, block_index, block_text, quote, body, author_name, is_claude, status")
    .order("created_at")
    .limit(5000);
  if (path) q = q.eq("path", path);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const replies = new Map<string, Row[]>();
  for (const r of rows) if (r.parent_id) replies.set(r.parent_id, [...(replies.get(r.parent_id) ?? []), r]);
  const msg = (r: Row): Msg => ({
    id: r.id,
    body: r.body,
    author: r.is_claude ? "Claude" : r.author_name,
    isClaude: r.is_claude,
    at: formatDate(r.created_at),
  });
  return rows
    .filter((r) => !r.parent_id)
    .map((r) => {
      const book = books.find((b) => b.path === r.path);
      const anchor = { blockIndex: r.block_index!, blockText: r.block_text!, quote: r.quote };
      return {
        id: r.id,
        path: r.path,
        blockIndex: book ? locateAnchor(book.blocks, anchor) : -1,
        hintIndex: r.block_index!,
        blockText: r.block_text!,
        quote: r.quote,
        status: r.status,
        messages: [r, ...(replies.get(r.id) ?? [])].map(msg),
      };
    });
}
