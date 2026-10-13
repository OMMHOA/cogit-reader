import "server-only";
import { supabase } from "./supabase";
import { locateSection } from "./blocks";
import type { Book } from "./books";

// A proofreader's own note on a chapter: only they can read it (row-level security), and no
// script reads the table, so Claude never sees it. `ids` are the rows shown as this note: more
// than one only when chapters moved and two notes now point at the same one; the next save
// keeps their merged text in the first and deletes the rest.
export type Note = { ids: string[]; body: string };

// The signed-in member's notes on one book, by the chapter each belongs to now. Without the
// notes table (its migration not run yet) there are none, rather than a broken chapter page.
export async function loadNotes(book: Book, me: string): Promise<Map<number, Note>> {
  const sb = await supabase();
  const { data, error } = await sb
    .from("notes")
    .select("id, section_index, section_title, body")
    .eq("author_id", me)
    .eq("path", book.path)
    .order("updated_at", { ascending: false });
  const notes = new Map<number, Note>();
  if (error) {
    console.error("notes:", error.message);
    return notes;
  }
  for (const n of data) {
    const s = locateSection(book.sections, n.section_index, n.section_title);
    const cur = notes.get(s);
    notes.set(s, cur ? { ids: [...cur.ids, n.id], body: `${cur.body}\n\n${n.body}` } : { ids: [n.id], body: n.body });
  }
  return notes;
}
