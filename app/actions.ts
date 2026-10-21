"use server";

import { redirect } from "next/navigation";
import { currentUser, type Member } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getBook } from "@/lib/books";
import { headSha, treeOf, blobText, commitFile } from "@/lib/github";
import { applyEdit, checkEdit, normalizeEdit } from "@/lib/blocks";

export type Result = { error?: string };

const AGAIN = "Jelentkezz be újra.";
const str = (v: unknown, max = 50000) => (typeof v === "string" && v.length <= max ? v : null);
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);

async function member(): Promise<Member | null> {
  return (await currentUser()).member;
}

function commitAuthor(m: Member) {
  const slug = m.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { name: m.name, email: `${slug || m.id.slice(0, 8)}@lektor.invalid` };
}

// One paragraph, straight to the branch as one commit by the proofreader.
export async function saveEdit(input: { slug: unknown; blockIndex: unknown; oldText: unknown; newText: unknown }): Promise<Result> {
  const m = await member();
  if (!m) return { error: AGAIN };
  const slug = str(input.slug, 200);
  const index = int(input.blockIndex);
  const oldText = str(input.oldText);
  const raw = str(input.newText);
  if (slug === null || index === null || oldText === null || raw === null) return { error: "Hibás kérés." };
  const newText = normalizeEdit(raw);
  const problem = checkEdit(oldText, newText);
  if (problem) return { error: problem };

  const book = await getBook(slug);
  if (!book) return { error: "Nincs ilyen könyv." };
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await headSha();
    const entry = (await treeOf(head)).find((e) => e.path === book.path);
    if (!entry) return { error: "Nincs ilyen könyv." };
    const edited = applyEdit(await blobText(entry.sha), index, oldText, newText);
    if (!edited)
      return { error: "Ez a bekezdés közben megváltozott. Töltsd újra az oldalt, és nézd meg az új szöveget." };
    const snippet = newText.replace(/\s+/g, " ").slice(0, 100);
    const sha = await commitFile({
      parentSha: head,
      path: book.path,
      content: edited.text,
      message: `Proofreading edit by ${m.name} (${slug})\n\n${snippet}${newText.length > 100 ? "…" : ""}\n\nSaved on the proofreading site.`,
      author: commitAuthor(m),
    });
    if (!sha) continue; // the branch moved; read it again
    const sb = await supabase();
    const { error } = await sb.from("edits").insert({
      path: book.path,
      block_index: edited.index,
      old_text: oldText,
      new_text: newText,
      commit_sha: sha,
      author_id: m.id,
    });
    if (error) console.error("edit log:", error.message);
    return {};
  }
  return { error: "Most nem sikerült menteni, próbáld újra egy perc múlva." };
}

export async function addComment(input: {
  slug: unknown;
  blockIndex: unknown;
  blockText: unknown;
  quote: unknown;
  body: unknown;
}): Promise<Result> {
  const m = await member();
  if (!m) return { error: AGAIN };
  const slug = str(input.slug, 200);
  const index = int(input.blockIndex);
  const blockText = str(input.blockText);
  const quote = input.quote == null ? null : str(input.quote, 2000);
  const body = str(input.body, 5000)?.trim();
  if (!slug || index === null || blockText === null || (input.quote != null && quote === null))
    return { error: "Hibás kérés." };
  if (!body) return { error: "Írd be a kérdést vagy a megjegyzést." };
  const book = await getBook(slug);
  if (!book) return { error: "Nincs ilyen könyv." };
  const sb = await supabase();
  const { error } = await sb.from("comments").insert({
    path: book.path,
    block_index: index,
    block_text: blockText,
    quote: quote?.trim() || null,
    body,
    author_id: m.id,
  });
  return error ? { error: "Nem sikerült elküldeni: " + error.message } : {};
}

export async function reply(input: { threadId: unknown; body: unknown }): Promise<Result> {
  const m = await member();
  if (!m) return { error: AGAIN };
  const threadId = str(input.threadId, 100);
  const body = str(input.body, 5000)?.trim();
  if (!threadId) return { error: "Hibás kérés." };
  if (!body) return { error: "Írd be a választ." };
  const sb = await supabase();
  const { data: root } = await sb.from("comments").select("path").eq("id", threadId).is("parent_id", null).single();
  if (!root) return { error: "Nincs ilyen beszélgetés." };
  const { error } = await sb.from("comments").insert({ path: root.path, parent_id: threadId, body, author_id: m.id });
  return error ? { error: "Nem sikerült elküldeni: " + error.message } : {};
}

export async function setStatus(input: { threadId: unknown; status: unknown }): Promise<Result> {
  const m = await member();
  if (!m) return { error: AGAIN };
  const threadId = str(input.threadId, 100);
  const status = input.status === "resolved" || input.status === "open" ? input.status : null;
  if (!threadId || !status) return { error: "Hibás kérés." };
  const sb = await supabase();
  const { error } = await sb.from("comments").update({ status }).eq("id", threadId).is("parent_id", null);
  return error ? { error: error.message } : {};
}

// A member's verdict on an error in the Arabic original (null takes it back), with a comment.
export async function decideError(input: { id: unknown; decision: unknown; comment: unknown }): Promise<Result> {
  const m = await member();
  if (!m) return { error: AGAIN };
  const id = str(input.id, 100);
  const decision = input.decision === "slip" || input.decision === "fact" ? input.decision : null;
  const comment = str(input.comment, 5000);
  if (!id || (input.decision !== null && !decision) || comment === null) return { error: "Hibás kérés." };
  const sb = await supabase();
  const { data, error } = await sb
    .from("arabic_errors")
    .update({ decision, comment: comment.trim() || null })
    .eq("id", id)
    .select("id");
  if (error) return { error: "Nem sikerült menteni: " + error.message };
  return data.length ? {} : { error: "Ezt Claude már átvezette a könyvbe, nem változtatható." };
}

// The member's own note on a chapter, or on a paragraph of it when `blockIndex` and `blockText`
// (the paragraph as it is now, which the note is anchored to from then on) are given
// (lib/notes.ts). `ids` are the rows shown as the note; an empty text deletes it. Returns the
// row the text is now in (null when deleted).
export async function saveNote(input: {
  slug: unknown;
  sec: unknown;
  title: unknown;
  blockIndex?: unknown;
  blockText?: unknown;
  ids: unknown;
  body: unknown;
}): Promise<Result & { id?: string | null }> {
  const m = await member();
  if (!m) return { error: AGAIN };
  const slug = str(input.slug, 200);
  const sec = int(input.sec);
  const title = str(input.title, 1000);
  const anchored = input.blockIndex != null;
  const blockIndex = anchored ? int(input.blockIndex) : null;
  const blockText = anchored ? str(input.blockText) : null;
  const ids = input.ids;
  const body = str(input.body, 20000)?.trim();
  if (
    !slug ||
    sec === null ||
    title === null ||
    (anchored && (blockIndex === null || !blockText)) ||
    body === undefined ||
    !Array.isArray(ids) ||
    ids.length > 20 ||
    !ids.every((id) => str(id, 100))
  )
    return { error: "Hibás kérés." };
  const book = await getBook(slug);
  if (!book) return { error: "Nincs ilyen könyv." };
  const sb = await supabase();
  let id: string | null = null;
  if (body) {
    const row = {
      section_index: sec,
      section_title: title,
      ...(anchored ? { block_index: blockIndex, block_text: blockText } : {}),
      body,
      updated_at: new Date().toISOString(),
    };
    // Its row may have been deleted meanwhile (another tab): then it's a new note.
    const updated = ids.length ? await sb.from("notes").update(row).eq("id", ids[0]).select("id").maybeSingle() : null;
    if (updated?.error) return { error: "Nem sikerült menteni: " + updated.error.message };
    id = updated?.data?.id ?? null;
    if (!id) {
      const { data, error } = await sb
        .from("notes")
        .insert({ ...row, path: book.path, author_id: m.id })
        .select("id")
        .single();
      if (error) return { error: "Nem sikerült menteni: " + error.message };
      id = data.id;
    }
  }
  const gone = ids.filter((x) => x !== id);
  if (gone.length) {
    const { error } = await sb.from("notes").delete().in("id", gone);
    if (error) return { error: "Nem sikerült menteni: " + error.message };
  }
  return { id };
}

export async function login(_: Result & { email?: string }, form: FormData): Promise<Result & { email?: string }> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const back = String(form.get("vissza") ?? "");
  const sb = await supabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "Hibás e-mail-cím vagy jelszó.", email };
  // Only a path on this site: "//x" and "/\\x" would leave it.
  redirect(/^\/(?![/\\])/.test(back) ? back : "/");
}

export async function logout() {
  const sb = await supabase();
  await sb.auth.signOut();
  redirect("/belepes");
}

export async function changePassword(_: Result & { done?: boolean }, form: FormData): Promise<Result & { done?: boolean }> {
  if (!(await currentUser()).signedIn) return { error: AGAIN };
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "A jelszó legalább 8 karakter legyen." };
  if (password !== String(form.get("again") ?? "")) return { error: "A két jelszó nem egyezik." };
  const sb = await supabase();
  const { error } = await sb.auth.updateUser({ password });
  return error ? { error: "Nem sikerült: " + error.message } : { done: true };
}
