#!/usr/bin/env node
// Posts the answers of the "Answer questions" workflow (.github/workflows/answer-questions.yml):
// the output of `claude -p --output-format json --json-schema …`, whose structured_output is
// { answers: [{ thread, answer }] }, thread being the short id `review.mjs questions` printed.
//
//   node scripts/post-answers.mjs <claude-output.json> <since>
//
// A thread that got a message from a person after <since> (when the questions were fetched) is
// left open: Claude hasn't seen that message, and the run its comment started will answer it.
import { readFileSync } from "node:fs";
import { adminClient, die } from "./env.mjs";

const [file, since] = process.argv.slice(2);
if (!file || !since) die("Usage: post-answers.mjs <claude-output.json> <since>");
const out = JSON.parse(readFileSync(file, "utf8"));
if (!out.structured_output) die(`No answers from Claude (${out.subtype}): ${out.result ?? ""}`);

const sb = adminClient();
const { data: all, error } = await sb
  .from("comments")
  .select("id, parent_id, path, status, is_claude, created_at")
  .limit(5000);
if (error) die(error.message);

let failed = false;
for (const { thread, answer } of out.structured_output.answers) {
  const hits = all.filter((r) => !r.parent_id && r.id.startsWith(thread));
  const root = hits.length === 1 && hits[0].status === "open" ? hits[0] : null;
  if (!root) {
    console.log(`${thread}: no such open thread.`);
    continue;
  }
  const newer = all.some(
    (r) => (r.id === root.id || r.parent_id === root.id) && !r.is_claude && new Date(r.created_at) > new Date(since),
  );
  if (newer) {
    console.log(`${thread}: a new message came in meanwhile, left for the next run.`);
    continue;
  }
  const { error } = await sb
    .from("comments")
    .insert({ path: root.path, parent_id: root.id, body: answer, is_claude: true, author_name: "Claude" });
  if (error) {
    console.log(`${thread}: ${error.message}`);
    failed = true;
  } else console.log(`${thread}: answered.`);
}
if (failed) process.exit(1);
