import "server-only";
import { supabase } from "./supabase";
import { locateAnchor } from "./blocks";
import { formatDate } from "./threads";
import type { Book } from "./books";

export type View = "slip" | "fact";

// An error in the Arabic original, waiting for a member's decision (supabase/migrations/
// 20261021000000_arabic_errors.sql), on the paragraph it is in now.
export type ArabicError = {
  id: string;
  path: string;
  blockIndex: number; // where the paragraph is now; -1 when it can't be found any more
  hintIndex: number; // where it was when added
  arabic: string;
  huNow: string;
  huFix: string;
  reason: string;
  claudeView: View;
  decision: View | null;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  applied: boolean;
};

type Row = {
  id: string;
  path: string;
  block_index: number;
  block_text: string;
  arabic: string;
  hu_now: string;
  hu_fix: string;
  reason: string;
  claude_view: View;
  decision: View | null;
  comment: string | null;
  decided_name: string | null;
  decided_at: string | null;
  applied_at: string | null;
};

// All of them, in book order.
export async function loadArabicErrors(books: Book[]): Promise<ArabicError[]> {
  const sb = await supabase();
  const { data, error } = await sb
    .from("arabic_errors")
    .select("id, path, block_index, block_text, arabic, hu_now, hu_fix, reason, claude_view, decision, comment, decided_name, decided_at, applied_at")
    .order("path")
    .order("block_index")
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data as Row[]).map((r) => {
    const book = books.find((b) => b.path === r.path);
    const anchor = { blockIndex: r.block_index, blockText: r.block_text, quote: r.hu_now };
    return {
      id: r.id,
      path: r.path,
      blockIndex: book ? locateAnchor(book.blocks, anchor) : -1,
      hintIndex: r.block_index,
      arabic: r.arabic,
      huNow: r.hu_now,
      huFix: r.hu_fix,
      reason: r.reason,
      claudeView: r.claude_view,
      decision: r.decision,
      comment: r.comment,
      decidedBy: r.decided_name,
      decidedAt: r.decided_at && formatDate(r.decided_at),
      applied: r.applied_at !== null,
    };
  });
}
