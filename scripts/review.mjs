#!/usr/bin/env node
// Claude's side of the proofreading site, run from a Claude Code session in the books repo.
//
//   node scripts/review.mjs status                     how much is waiting
//   node scripts/review.mjs questions [--all]          threads waiting for an answer (all: every thread)
//   node scripts/review.mjs answer <thread-id> <text>  reply as Claude (text "-" = read stdin)
//   node scripts/review.mjs edits [--all]              edits not reviewed yet, as word diffs
//   node scripts/review.mjs keep <edit-id>...          mark edits as fine
//   node scripts/review.mjs revert <edit-id> <text>    mark an edit as reverted (after reverting it in
//                                                      git and pushing) and explain why, under the
//                                                      paragraph and in the list of edits
//   node scripts/review.mjs anchors                    threads and edit marks whose paragraph
//                                                      changed or is lost (run from an up-to-date
//                                                      checkout after joining or splitting
//                                                      paragraphs in git; fix a lost one with
//                                                      reanchor)
//   node scripts/review.mjs reanchor <thread-id> <n>   put a thread on paragraph n as it is now
//   node scripts/review.mjs errors [--all]             errors in the Arabic original not carried into
//                                                      the books yet, with the decisions (all: also
//                                                      the ones done)
//   node scripts/review.mjs errors add <file.json>     add errors for a decision on the site: a list of
//                                                      { path, arabic, hu_now, hu_fix, reason,
//                                                      claude_view: "slip" | "fact" }, hu_now found
//                                                      in the paragraph it is in (run from the books
//                                                      repo; one already there is skipped)
//   node scripts/review.mjs errors done <id>...        mark errors as carried into the books
// Ids may be shortened to their first 8 characters.
import { readFileSync } from "node:fs";
import { adminClient, die } from "./env.mjs";
import { locateAnchor, parseBlocks, wordDiff } from "../lib/blocks.ts";

const sb = adminClient();
const [cmd, ...args] = process.argv.slice(2);
const text = (t) => (t === "-" ? readFileSync(0, "utf8").trim() : t);

async function rows(table, select, where = (q) => q) {
  const { data, error } = await where(sb.from(table).select(select)).order("created_at").limit(5000);
  if (error) die(error.message);
  return data;
}

async function resolveId(table, short) {
  if (!short) die("Missing id.");
  const all = await rows(table, "id");
  const hits = all.filter((r) => r.id.startsWith(short));
  if (hits.length !== 1) die(`${hits.length ? "Ambiguous" : "No"} ${table} id ${short}.`);
  return hits[0].id;
}

const indent = (s, p = "    ") => s.replace(/^/gm, p);

if (cmd === "status") {
  const threads = await rows("comments", "status", (q) => q.is("parent_id", null));
  const edits = await rows("edits", "status");
  const n = (list, s) => list.filter((r) => r.status === s).length;
  console.log(`Questions waiting: ${n(threads, "open")} (answered ${n(threads, "answered")}, closed ${n(threads, "resolved")})`);
  console.log(`Edits to review:   ${n(edits, "pending")} (kept ${n(edits, "kept")}, reverted ${n(edits, "reverted")})`);
  const errs = await rows("arabic_errors", "decision, applied_at");
  const open = errs.filter((r) => !r.applied_at);
  console.log(`Arabic errors:     ${open.filter((r) => r.decision).length} decided, waiting to be carried out (undecided ${open.filter((r) => !r.decision).length}, done ${errs.length - open.length})`);
} else if (cmd === "questions") {
  const all = await rows("comments", "*");
  const roots = all.filter((r) => !r.parent_id && (args.includes("--all") || r.status === "open"));
  if (!roots.length) console.log("No questions waiting.");
  for (const r of roots) {
    console.log(`=== ${r.id.slice(0, 8)}  [${r.status}]  ${r.path}  block ${r.block_index}`);
    console.log("Paragraph:\n" + indent(r.block_text));
    if (r.quote) console.log(`Selected: „${r.quote}”`);
    for (const m of [r, ...all.filter((x) => x.parent_id === r.id)])
      console.log(`--- ${m.is_claude ? "Claude" : m.author_name}, ${m.created_at.slice(0, 16)}:\n${indent(m.body)}`);
    console.log();
  }
} else if (cmd === "answer") {
  const id = await resolveId("comments", args[0]);
  const body = text(args[1] ?? "");
  if (!body) die("Missing text.");
  const { data: root } = await sb.from("comments").select("path, parent_id").eq("id", id).single();
  if (root.parent_id) die("That is a reply; give the thread's first comment.");
  const { error } = await sb
    .from("comments")
    .insert({ path: root.path, parent_id: id, body, is_claude: true, author_name: "Claude" });
  if (error) die(error.message);
  console.log(`Answered ${id.slice(0, 8)}.`);
} else if (cmd === "edits") {
  const edits = await rows("edits", "*", (q) => (args.includes("--all") ? q : q.eq("status", "pending")));
  if (!edits.length) console.log("No edits to review.");
  for (const e of edits) {
    console.log(`=== ${e.id.slice(0, 8)}  [${e.status}]  ${e.author_name}, ${e.created_at.slice(0, 16)}  ${e.path}  block ${e.block_index}  commit ${e.commit_sha.slice(0, 7)}`);
    console.log(
      indent(
        wordDiff(e.old_text, e.new_text)
          .map((p) => (p.kind === "same" ? p.text : p.kind === "del" ? `[-${p.text}-]` : `{+${p.text}+}`))
          .join(""),
      ),
    );
    if (e.note) console.log("Note: " + e.note);
    console.log();
  }
} else if (cmd === "keep") {
  if (!args.length) die("Missing edit ids.");
  for (const short of args) {
    const id = await resolveId("edits", short);
    const { error } = await sb.from("edits").update({ status: "kept" }).eq("id", id);
    if (error) die(error.message);
    console.log(`Kept ${id.slice(0, 8)}.`);
  }
} else if (cmd === "revert") {
  const id = await resolveId("edits", args[0]);
  const note = text(args[1] ?? "");
  if (!note) die("Missing explanation.");
  const { data: e } = await sb.from("edits").select("*").eq("id", id).single();
  const { error } = await sb.from("edits").update({ status: "reverted", note }).eq("id", id);
  if (error) die(error.message);
  // The explanation also goes under the restored paragraph, as a thread the proofreader can answer.
  const { error: err2 } = await sb.from("comments").insert({
    path: e.path,
    block_index: e.block_index,
    block_text: e.old_text,
    body: `Ezt a javítást visszaállítottam: ${note}`,
    is_claude: true,
    author_name: "Claude",
    status: "answered",
  });
  if (err2) die(err2.message);
  console.log(`Reverted ${id.slice(0, 8)} and left the note under the paragraph.`);
} else if (cmd === "anchors") {
  // The books as checked out here (run from the books repo); the site reads master.
  const books = new Map();
  const book = (path) => {
    if (!books.has(path)) books.set(path, parseBlocks(readFileSync(path, "utf8")));
    return books.get(path);
  };
  const threads = await rows("comments", "id, path, block_index, block_text, quote, status", (q) => q.is("parent_id", null));
  const edits = await rows("edits", "id, path, block_index, new_text, status");
  let shown = 0;
  const report = (kind, r, text, quote) => {
    const blocks = book(r.path);
    const at = locateAnchor(blocks, { blockIndex: r.block_index, blockText: text, quote });
    if (at !== -1 && blocks[at].text === text) return;
    shown++;
    const where = at === -1 ? "LOST, shown under its chapter without a paragraph" : `on ${at}, text changed since`;
    console.log(`${kind} ${r.id.slice(0, 8)}  [${r.status}]  ${r.path}  block ${r.block_index}: ${where}`);
    if (at === -1) console.log(indent(text));
  };
  for (const t of threads) if (t.block_index !== null) report("thread", t, t.block_text, t.quote);
  for (const e of edits) report("edit  ", e, e.new_text, null);
  if (!shown) console.log("Every thread and edit mark is on its paragraph, unchanged.");
} else if (cmd === "reanchor") {
  const id = await resolveId("comments", args[0]);
  const index = Number(args[1]);
  const { data: root } = await sb.from("comments").select("path, parent_id").eq("id", id).single();
  if (root.parent_id) die("That is a reply; give the thread's first comment.");
  const block = parseBlocks(readFileSync(root.path, "utf8"))[index];
  if (!Number.isInteger(index) || !block) die(`No paragraph ${args[1]} in ${root.path}.`);
  const { error } = await sb.from("comments").update({ block_index: index, block_text: block.text }).eq("id", id);
  if (error) die(error.message);
  console.log(`Thread ${id.slice(0, 8)} is on paragraph ${index}:\n${indent(block.text)}`);
} else if (cmd === "errors" && args[0] === "add") {
  const items = JSON.parse(readFileSync(args[1] ?? die("Missing file."), "utf8"));
  const have = await rows("arabic_errors", "path, hu_now");
  for (const it of items) {
    if (!["path", "arabic", "hu_now", "hu_fix", "reason"].every((k) => typeof it[k] === "string" && it[k]))
      die(`Missing a field in ${JSON.stringify(it).slice(0, 100)}`);
    if (!["slip", "fact"].includes(it.claude_view)) die(`claude_view must be slip or fact: ${it.hu_now}`);
    if (have.some((h) => h.path === it.path && h.hu_now === it.hu_now)) {
      console.log(`Already there: ${it.hu_now.slice(0, 60)}`);
      continue;
    }
    const hits = parseBlocks(readFileSync(it.path, "utf8")).filter((b) => b.text.includes(it.hu_now));
    if (hits.length !== 1) die(`${hits.length} paragraphs contain: ${it.hu_now}`);
    const { error } = await sb.from("arabic_errors").insert({
      path: it.path,
      block_index: hits[0].index,
      block_text: hits[0].text,
      arabic: it.arabic,
      hu_now: it.hu_now,
      hu_fix: it.hu_fix,
      reason: it.reason,
      claude_view: it.claude_view,
    });
    if (error) die(error.message);
    console.log(`Added (block ${hits[0].index}): ${it.hu_now.slice(0, 60)}`);
  }
} else if (cmd === "errors" && args[0] === "done") {
  if (args.length < 2) die("Missing ids.");
  for (const short of args.slice(1)) {
    const id = await resolveId("arabic_errors", short);
    const { error } = await sb.from("arabic_errors").update({ applied_at: new Date().toISOString() }).eq("id", id);
    if (error) die(error.message);
    console.log(`Done ${id.slice(0, 8)}.`);
  }
} else if (cmd === "errors") {
  const all = await rows("arabic_errors", "*", (q) => (args.includes("--all") ? q : q.is("applied_at", null)));
  if (!all.length) console.log("No errors waiting.");
  const view = { slip: "slip", fact: "fact (keep the note)" };
  for (const e of all.sort((a, b) => a.path.localeCompare(b.path) || a.block_index - b.block_index)) {
    const verdict = e.decision ? `${view[e.decision]}, by ${e.decided_name} ${e.decided_at.slice(0, 16)}` : "undecided";
    console.log(`=== ${e.id.slice(0, 8)}  [${verdict}]${e.applied_at ? "  [done]" : ""}  ${e.path}  block ${e.block_index}`);
    console.log(`Arabic: ${e.arabic}\nNow:    ${e.hu_now}\nFix:    ${e.hu_fix}\nClaude: ${view[e.claude_view]}. ${e.reason}`);
    if (e.comment) console.log(`Comment:\n${indent(e.comment)}`);
    console.log();
  }
} else {
  die("Commands: status, questions, answer, edits, keep, revert, anchors, reanchor, errors (see the top of this file).");
}
