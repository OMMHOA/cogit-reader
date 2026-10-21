import "server-only";
import { supabase } from "./supabase";
import { locateAnchor, locateSection, sectionOf } from "./blocks";
import type { Book } from "./books";

// A proofreader's own note on a chapter or on a paragraph: only they can read it (row-level
// security), and no script reads the table, so Claude never sees it. `ids` are the rows shown
// as this note: more than one only when chapters or paragraphs moved and two notes now point at
// the same one; the next save keeps their merged text in the first and deletes the rest.
export type Note = { ids: string[]; body: string; at: string }; // at: last saved

export type BookNotes = {
  chapters: Map<number, Note>; // by chapter index
  paragraphs: Map<number, Note>; // by the paragraph's block index now
  // Paragraphs that can't be found any more: the note stays in the chapter, with the old text.
  lost: { section: number; hintIndex: number; blockText: string; note: Note }[];
};

type Row = {
  id: string;
  path: string;
  section_index: number;
  section_title: string;
  block_index: number | null;
  block_text: string | null;
  body: string;
  updated_at: string;
};

function add(map: Map<number, Note>, at: number, r: Row) {
  const cur = map.get(at);
  map.set(
    at,
    cur ? { ...cur, ids: [...cur.ids, r.id], body: `${cur.body}\n\n${r.body}` } : { ids: [r.id], body: r.body, at: r.updated_at },
  );
}

// The signed-in member's notes, newest first: on one book, or on all. Without the notes table
// (its migrations not run yet) there are none, rather than a broken page.
async function query(me: string, path?: string): Promise<Row[]> {
  const sb = await supabase();
  let q = sb
    .from("notes")
    .select("id, path, section_index, section_title, block_index, block_text, body, updated_at")
    .eq("author_id", me);
  if (path) q = q.eq("path", path);
  const { data, error } = await q.order("updated_at", { ascending: false });
  if (error) {
    console.error("notes:", error.message);
    return [];
  }
  return data as Row[];
}

// Notes on one book, each where it belongs now.
function place(book: Book, rows: Row[]): BookNotes {
  const notes: BookNotes = { chapters: new Map(), paragraphs: new Map(), lost: [] };
  for (const r of rows) {
    if (r.block_index === null || r.block_text === null) {
      add(notes.chapters, locateSection(book.sections, r.section_index, r.section_title), r);
      continue;
    }
    const at = locateAnchor(book.blocks, { blockIndex: r.block_index, blockText: r.block_text, quote: null });
    if (at !== -1) add(notes.paragraphs, at, r);
    else
      notes.lost.push({
        section: sectionOf(book.sections, r.block_index),
        hintIndex: r.block_index,
        blockText: r.block_text,
        note: { ids: [r.id], body: r.body, at: r.updated_at },
      });
  }
  return notes;
}

export async function loadNotes(book: Book, me: string): Promise<BookNotes> {
  return place(book, await query(me, book.path));
}

// All of them, by book in the order of `books` (those with notes), for the list of notes.
export async function loadAllNotes(books: Book[], me: string): Promise<{ book: Book; notes: BookNotes }[]> {
  const rows = await query(me);
  return books.flatMap((book) => {
    const mine = rows.filter((r) => r.path === book.path);
    return mine.length ? [{ book, notes: place(book, mine) }] : [];
  });
}
