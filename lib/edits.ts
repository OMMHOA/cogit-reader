import "server-only";
import { supabase } from "./supabase";
import { locateAnchor } from "./blocks";
import { formatDate } from "./threads";
import type { Book } from "./books";

export type EditStatus = "pending" | "kept" | "reverted";

// An edit made on the site, on the paragraph it belongs to now: its new text where it still is,
// else the most similar paragraph near its old place (it was edited again since).
export type EditMark = {
  id: string;
  blockIndex: number; // -1 when it can't be found any more
  author: string;
  mine: boolean;
  at: string;
  status: EditStatus;
  oldText: string;
  newText: string;
};

type Row = {
  id: string;
  created_at: string;
  block_index: number;
  old_text: string;
  new_text: string;
  author_id: string | null;
  author_name: string;
  status: EditStatus;
};

// The edits of one book that are still in it (reverted ones aren't), oldest first.
export async function loadEdits(book: Book, me: string): Promise<EditMark[]> {
  const sb = await supabase();
  const { data, error } = await sb
    .from("edits")
    .select("id, created_at, block_index, old_text, new_text, author_id, author_name, status")
    .eq("path", book.path)
    .neq("status", "reverted")
    .order("created_at")
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data as Row[]).map((e) => ({
    id: e.id,
    blockIndex: locateAnchor(book.blocks, { blockIndex: e.block_index, blockText: e.new_text, quote: null }),
    author: e.author_name,
    mine: e.author_id === me,
    at: formatDate(e.created_at),
    status: e.status,
    oldText: e.old_text,
    newText: e.new_text,
  }));
}
