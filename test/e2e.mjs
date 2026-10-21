#!/usr/bin/env node
// End-to-end test against a running site (`next start`) that uses the local Supabase and
// test/fake-github.mjs. Needs the test users from scripts/admin.mjs:
//   teszt@example.com / jelszo-teszt-1 (member), kollega@example.com / jelszo-teszt-3 (member),
//   kivulallo@example.com / jelszo-teszt-2 (no access)
// Env: BASE_URL, BARE_REPO (the fake GitHub's repo), ENV_FILE (for the scripts), SHOTS (optional
// directory for screenshots).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { env } from "../scripts/env.mjs";
import { parseBlocks } from "../lib/blocks.ts";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const BARE = process.env.BARE_REPO;
const SHOTS = process.env.SHOTS;
const MH = "muslim-home/MuslimHome-Muhammad-Salih-al-Munajjid-HUN.md";
const git = (...args) => execFileSync("git", ["--git-dir", BARE, ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const review = (...args) =>
  execFileSync("node", [new URL("../scripts/review.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" });
// review.mjs from a checkout of the fake GitHub's repo (the commands that read the books there).
const reviewIn = (dir, ...args) =>
  execFileSync("node", [new URL("../scripts/review.mjs", import.meta.url).pathname, ...args], { encoding: "utf8", cwd: dir });

// A commit made "elsewhere" (like a push from the books repo), via a throwaway clone. A file
// that isn't there yet starts empty.
function commitElsewhere(path, change, message) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"));
  try {
    execFileSync("git", ["clone", "-q", BARE, dir]);
    const file = join(dir, path);
    writeFileSync(file, change(existsSync(file) ? readFileSync(file, "utf8") : ""));
    execFileSync("git", ["-C", dir, "add", path]);
    execFileSync("git", ["-C", dir, "-c", "user.name=Books", "-c", "user.email=b@x.invalid", "commit", "-qm", message]);
    execFileSync("git", ["-C", dir, "push", "-q", "origin", "HEAD:master"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

let step = 0;
const ok = (msg) => console.log(`ok ${++step} - ${msg}`);
// Server-action redirects are client-side navigations: no load event, so wait for the path.
const waitPath = (page, path) => page.waitForFunction((p) => location.pathname + location.search === p, path);
// The n-th text paragraph on the page, pinned by its id (the editor replaces its text).
const para = async (page, n) => page.locator(`#${await page.locator(".blk:has(.md > p)").nth(n).getAttribute("id")}`);
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
// Supabase as a user, straight against the API (row-level security applies).
const e = env();
async function apiAs(email, password) {
  const c = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  if (!email) return { c, user: null };
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return { c, user: data.user };
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "hu-HU" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

  // Login, with a wrong password first; then back to the page asked for.
  await page.goto(`${BASE}/k/muslim-home/2`);
  assert.match(page.url(), /\/belepes\?vissza=%2Fk%2Fmuslim-home%2F2$/);
  await shot(page, "01-login");
  await page.fill("input[name=email]", "teszt@example.com");
  await page.fill("input[name=password]", "rossz-jelszo");
  await page.click("button.primary");
  await page.locator(".error").waitFor();
  assert.equal(await page.locator(".error").textContent(), "Hibás e-mail-cím vagy jelszó.");
  await page.fill("input[name=password]", "jelszo-teszt-1");
  await page.click("button.primary");
  await waitPath(page, "/k/muslim-home/2");
  await page.locator(".blk").first().waitFor();
  ok("login rejects a wrong password and returns to the page asked for");
  await shot(page, "02-chapter");

  // Edit a paragraph: the guard first, then a real edit.
  const blk = await para(page, 2);
  const blkId = await blk.getAttribute("id");
  await blk.click();
  await shot(page, "03-menu");
  await blk.getByRole("button", { name: "Javítás" }).click();
  const ta = blk.locator("textarea.edit");
  const old = await ta.inputValue();
  await ta.fill(old + "\nÚj sor");
  await blk.getByRole("button", { name: "Mentés" }).click();
  await blk.locator(".error").waitFor();
  assert.match(await blk.locator(".error").textContent(), /sorok száma/);
  ok("an edit that adds a line is refused");
  const edited = /[.!?…]$/.test(old) ? old.replace(/([.!?…])$/, " (teszt)$1") : old + " (teszt)";
  await ta.fill(edited);
  await shot(page, "04-editing");
  const headBefore = git("rev-parse", "master");
  await blk.getByRole("button", { name: "Mentés" }).click();
  await page.locator(`#${blkId} .saved`).waitFor();
  await page.locator(`#${blkId} .md`, { hasText: "(teszt)" }).waitFor();
  assert.equal(git("rev-parse", "master^"), headBefore);
  assert.equal(git("log", "-1", "--format=%an <%ae>", "master"), "Teszt Elek <teszt-elek@lektor.invalid>");
  const stat = git("diff", "--numstat", "master^", "master");
  assert.equal(stat, `1\t1\t${MH}`);
  assert.ok(git("show", `master:${MH}`).includes(edited));
  ok("a valid edit becomes one commit by the proofreader that changes one line");

  // The edited paragraph is marked as ours, and what changed is a click away.
  await page.locator(`#${blkId}.edited.by-me:not(.by-others)`).waitFor();
  assert.deepEqual(await page.locator(".legend .key").allTextContents(), ["te javítottad"]);
  await blk.click();
  await blk.getByRole("button", { name: "Ki mit javított?" }).click();
  await blk.locator(".changes .change.by-me ins", { hasText: "(teszt)" }).waitFor();
  assert.match(await blk.locator(".changes .meta").textContent(), /^Te · .*Ellenőrzésre vár$/);
  await shot(page, "04b-changes");
  await blk.locator(".changes .close").click();
  await blk.locator(".changes").waitFor({ state: "detached" });
  ok("an edited paragraph gets a change bar as yours, and shows its word diff");

  // Ask about selected words.
  const blk2 = await para(page, 4);
  const p2 = blk2.locator(".md > p").first();
  const box = await p2.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 12, { steps: 5 });
  await page.mouse.up();
  await blk2.getByRole("button", { name: "Kérdés a kijelölt szövegről" }).click();
  const quote = await blk2.locator(".tools .quote").textContent();
  assert.ok(quote.length > 3);
  await blk2.locator("textarea").fill("Miért ez a szó áll itt?");
  await shot(page, "05-question");
  await blk2.getByRole("button", { name: "Küldés" }).click();
  await blk2.locator(".thread .chip.open").waitFor();
  assert.equal(await blk2.locator(".thread .quote").textContent(), quote);
  ok("a question about selected words appears under the paragraph, waiting for an answer");

  // Claude answers from the command line.
  const listed = review("questions");
  assert.ok(listed.includes("Miért ez a szó áll itt?") && listed.includes(`Selected: „${quote}”`));
  const threadId = /=== (\w{8})/.exec(listed)[1];
  review("answer", threadId, "Mert az arab eredetiben is ez áll.");
  await page.reload();
  await blk2.locator(".thread .chip.answered").waitFor();
  assert.ok((await blk2.locator(".msg.claude .body").textContent()).includes("arab eredetiben"));
  await shot(page, "06-answered");
  ok("Claude's answer shows under the paragraph and marks the thread answered");

  // The proofreader replies (reopens), then closes the thread.
  await blk2.getByRole("button", { name: "Válasz" }).click();
  await blk2.locator(".thread textarea").fill("Köszönöm, értem.");
  await blk2.getByRole("button", { name: "Küldés" }).click();
  await blk2.locator(".thread .chip.open").waitFor();
  await blk2.getByRole("button", { name: "Lezárás" }).click();
  await blk2.locator(".thread-collapsed").waitFor();
  ok("a reply reopens the thread; closing collapses it");

  // The lists.
  await page.goto(`${BASE}/kerdesek?lap=lezart`);
  await page.locator(".qa", { hasText: "Miért ez a szó áll itt?" }).waitFor();
  await page.goto(`${BASE}/javitasok`);
  await page.locator(".edit-item ins", { hasText: "(teszt)" }).waitFor();
  assert.equal(await page.locator(".edit-item .chip").first().textContent(), "Ellenőrzésre vár");
  await shot(page, "07-edits");
  ok("the questions and edits pages list them");

  // Claude reverts the edit: a commit in the books repo, then the note.
  const edits = review("edits");
  assert.ok(edits.includes("{+(teszt)+}") || edits.includes("{+ (teszt)+}") || /\{\+[^+]*\(teszt\)/.test(edits));
  const editId = /=== (\w{8})/.exec(edits)[1];
  commitElsewhere(MH, (s) => s.replace(edited, old), "Revert a proofreading edit");
  review("revert", editId, "a bekezdés így pontosan követi az arab szöveget.");
  await page.goto(`${BASE}/k/muslim-home/2`);
  await page.locator(`#${blkId} .msg.claude`, { hasText: "visszaállítottam" }).waitFor();
  assert.ok(!(await page.locator(`#${blkId} .md`).textContent()).includes("(teszt)"));
  assert.equal(await page.locator(`#${blkId}.edited`).count(), 0);
  await page.goto(`${BASE}/javitasok`);
  assert.equal(await page.locator(".edit-item .chip").first().textContent(), "Visszaállítva");
  await page.locator(".edit-item .note", { hasText: "arab szöveget" }).waitFor();
  ok("a reverted edit shows Claude's reason under the paragraph and in the edits list, and loses its mark");

  // A colleague's edit (logged through the API as the site does after its commit), then one of
  // ours on the same paragraph.
  const kata = await apiAs("kollega@example.com", "jelszo-teszt-3");
  await page.goto(`${BASE}/k/muslim-home/2`);
  const kBlk = await para(page, 3);
  const kId = await kBlk.getAttribute("id");
  await kBlk.click();
  await kBlk.getByRole("button", { name: "Javítás" }).click();
  const kText = await kBlk.locator("textarea.edit").inputValue();
  await kBlk.getByRole("button", { name: "Mégse" }).click();
  const { error: kErr } = await kata.c.from("edits").insert({
    path: MH,
    block_index: Number(kId.slice(2)),
    old_text: kText.replace(/\S+$/, "régi."),
    new_text: kText,
    commit_sha: "0".repeat(40),
    author_id: kata.user.id,
  });
  assert.ifError(kErr);
  await page.reload();
  await page.locator(`#${kId}.edited.by-others:not(.by-me)`).waitFor();
  assert.deepEqual(await page.locator(".legend .key").allTextContents(), ["más javította"]);
  await kBlk.click();
  await kBlk.getByRole("button", { name: "Javítás" }).click();
  await kBlk.locator("textarea.edit").fill(kText + " (mi is)");
  await kBlk.getByRole("button", { name: "Mentés" }).click();
  await page.locator(`#${kId}.edited.by-me.by-others`).waitFor();
  await kBlk.click();
  await kBlk.getByRole("button", { name: "Ki mit javított?" }).click();
  assert.deepEqual(await kBlk.locator(".changes .meta b").allTextContents(), ["Kolléga Kata", "Te"]);
  await kBlk.locator(".changes .change.by-others ins", { hasText: kText.split(/\s+/).at(-1) }).waitFor();
  await shot(page, "07b-marks");
  await kBlk.getByText("Bezárás", { exact: true }).click();
  ok("a colleague's edit gets their mark, both of ours a two-tone one, with who changed what");

  // A personal note on the chapter: written from the corner button, saves itself.
  const me = await apiAs("teszt@example.com", "jelszo-teszt-1");
  const NOTE = "Itt tartok, holnap folytatom.\nA 3. bekezdést még egyszer.";
  await page.locator(".note-fab").click();
  await page.locator(".note-panel textarea").fill(NOTE);
  await page.locator(".note-panel .saved-mark").waitFor();
  await shot(page, "07c-note");
  await page.keyboard.press("Escape");
  await page.locator(".note-fab.has").waitFor();
  await page.reload();
  assert.equal(await page.locator(".note-card .note-body").innerText(), NOTE);
  // Each chapter has its own; one written just before leaving the chapter is saved too.
  await page.goto(`${BASE}/k/muslim-home/3`);
  assert.equal(await page.locator(".note-card").count(), 0);
  await page.locator(".note-fab").click();
  await page.locator(".note-panel textarea").fill("Másik fejezet.");
  await page.locator(".crumbs a").click();
  await waitPath(page, "/k/muslim-home");
  for (let i = 0; i < 40; i++) {
    const { data } = await me.c.from("notes").select("body");
    if (data.length === 2) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.reload();
  const tocNotes = await page.locator(".toc li").evaluateAll((lis) => lis.map((li) => !!li.querySelector(".count.note")));
  assert.deepEqual(tocNotes.flatMap((has, i) => (has ? [i] : [])), [2, 3]);
  await page.goto(`${BASE}/k/muslim-home/3`);
  await page.locator(".note-card", { hasText: "Másik fejezet." }).click();
  await page.locator(".note-panel textarea").fill("");
  await page.locator(".note-panel .saved-mark").waitFor();
  assert.equal(await page.locator(".note-card").count(), 0);
  const { data: myNotes } = await me.c.from("notes").select("id, body, section_index");
  assert.deepEqual(myNotes.map((n) => [n.body, n.section_index]), [[NOTE, 2]]);
  ok("a personal note per chapter saves itself (also when leaving at once), shows in the contents, goes when emptied");

  // A note on one paragraph: written under it from its menu; it follows the paragraph through
  // an edit, and stays in the chapter (with the old text) when the paragraph is rewritten.
  await page.goto(`${BASE}/k/muslim-home/2`);
  const nBlk = await para(page, 5);
  const nId = await nBlk.getAttribute("id");
  const PNOTE = "Ezt a szót még nézd meg.";
  await nBlk.click();
  await nBlk.getByRole("button", { name: "Saját jegyzet" }).click();
  await nBlk.locator(".pnote textarea").fill(PNOTE);
  await nBlk.locator(".pnote .saved-mark").waitFor();
  await shot(page, "07d-paragraph-note");
  await nBlk.getByRole("button", { name: "Kész" }).click();
  assert.equal(await nBlk.locator(".pnote .note-body").textContent(), PNOTE);
  await page.reload();
  await page.locator(`#${nId} .pnote .note-body`, { hasText: PNOTE }).waitFor();
  assert.equal(await page.locator(".pnote").count(), 1);
  await nBlk.locator(".md").click({ position: { x: 5, y: 5 } });
  await nBlk.getByRole("button", { name: "Javítás" }).click();
  const nOld = await nBlk.locator("textarea.edit").inputValue();
  await nBlk.locator("textarea.edit").fill(nOld + " (jav.)");
  await nBlk.getByRole("button", { name: "Mentés" }).click();
  await page.locator(`#${nId} .md`, { hasText: "(jav.)" }).waitFor();
  await page.locator(`#${nId} .pnote .note-body`, { hasText: PNOTE }).waitFor();
  // Saving it again anchors it to the paragraph as it is now.
  await nBlk.locator(".pnote").click();
  await nBlk.locator(".pnote textarea").fill(PNOTE + " Kész.");
  await nBlk.locator(".pnote .saved-mark").waitFor();
  await page.keyboard.press("Escape");
  const { data: pRows } = await me.c.from("notes").select("block_text, body").not("block_index", "is", null);
  assert.deepEqual(pRows, [{ block_text: nOld + " (jav.)", body: PNOTE + " Kész." }]);
  commitElsewhere(MH, (s) => s.replace(nOld + " (jav.)", "Egészen más bekezdés került ide, semmi köze az előzőhöz."), "Rewrite a paragraph");
  await page.reload();
  await page.locator(".orphans .pnote .note-body", { hasText: PNOTE }).waitFor();
  assert.equal(await page.locator(`#${nId} .pnote`).count(), 0);
  assert.ok((await page.locator(".orphans blockquote.was").last().textContent()).includes("(jav.)"));
  await page.goto(`${BASE}/k/muslim-home`);
  assert.equal(await page.locator(".toc li").nth(2).locator(".count.note").textContent(), "2 jegyzet");
  await page.goto(`${BASE}/k/muslim-home/2`);
  await page.locator(".orphans .pnote").click();
  await page.locator(".orphans .pnote textarea").fill("");
  await page.locator(".orphans .pnote .saved-mark").waitFor();
  await page.getByRole("button", { name: "Kész" }).click();
  assert.equal(await page.locator(".pnote").count(), 0);
  ok("a note on a paragraph: under it, follows it through an edit, kept in the chapter when the paragraph is rewritten");

  // A stale page: another paragraph changed meanwhile → saving still works and keeps that change;
  // the same paragraph changed meanwhile → refused.
  await page.goto(`${BASE}/k/muslim-home/2`);
  const a = await para(page, 6);
  const b = await para(page, 7);
  const aText = (await a.locator(".md").innerText()).trim();
  commitElsewhere(
    MH,
    (s) => s.replace("## A család megalapítása\n\n", "## A család megalapítása\n\nÚj bekezdés máshonnan.\n\n"),
    "Insert a paragraph above",
  );
  await b.click();
  await b.getByRole("button", { name: "Javítás" }).click();
  const bOld = await b.locator("textarea.edit").inputValue();
  await b.locator("textarea.edit").fill(bOld + " B");
  await b.getByRole("button", { name: "Mentés" }).click();
  await page.locator(".saved").waitFor();
  const after = git("show", `master:${MH}`);
  assert.ok(after.includes("Új bekezdés máshonnan.") && after.includes(bOld + " B"));
  ok("an edit from a stale page lands on the moved paragraph and keeps the other change");
  await a.click();
  await a.getByRole("button", { name: "Javítás" }).click();
  const aOld = await a.locator("textarea.edit").inputValue();
  commitElsewhere(MH, (s) => s.replace(aOld, aOld + " M"), "Change the same paragraph elsewhere");
  await a.locator("textarea.edit").fill(aOld + " X");
  await a.getByRole("button", { name: "Mentés" }).click();
  await a.locator(".error").waitFor();
  assert.match(await a.locator(".error").textContent(), /közben megváltozott/);
  assert.ok(aText.length > 0);
  ok("an edit of a paragraph changed meanwhile is refused");

  // Footnotes: links work, markers can't be removed.
  await page.goto(`${BASE}/k/fiqh-us-seerah/4`);
  await page.locator("a.fnref").first().click();
  assert.match(page.url(), /#fn-\d+$/);
  const fnBlk = page.locator(`#${await page.locator(".blk", { has: page.locator("a.fnref") }).first().getAttribute("id")}`);
  await fnBlk.locator(".md").click({ position: { x: 5, y: 5 } });
  await fnBlk.getByRole("button", { name: "Javítás" }).click();
  const fnOld = await fnBlk.locator("textarea.edit").inputValue();
  await fnBlk.locator("textarea.edit").fill(fnOld.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/, ""));
  await fnBlk.getByRole("button", { name: "Mentés" }).click();
  await fnBlk.locator(".error").waitFor();
  assert.match(await fnBlk.locator(".error").textContent(), /lábjegyzet/);
  ok("footnote markers link to their notes and can't be removed by an edit");
  await page.goto(`${BASE}/k/fiqh-us-seerah/4`);
  await shot(page, "08-fiqh-chapter");

  // The English and Arabic text of one paragraph: the English has the same footnote markers.
  const enBlk = page.locator(`#${await page.locator(".blk", { has: page.locator("a.fnref") }).nth(1).getAttribute("id")}`);
  const marks = await enBlk.locator(".md a.fnref").allTextContents();
  await enBlk.locator(".md").click({ position: { x: 5, y: 5 } });
  await enBlk.getByRole("button", { name: "Angol szöveg" }).click();
  await enBlk.locator(".par .par-text[lang=en] p").first().waitFor();
  const en = await enBlk.locator(".par .par-text").innerText();
  assert.ok(marks.length && marks.every((m) => en.includes(m)), `${marks} in ${en.slice(0, 200)}`);
  await shot(page, "09-english");
  await enBlk.getByRole("button", { name: "Arab szöveg" }).click();
  await enBlk.locator(".par .par-text[dir=rtl][lang=ar] p").first().waitFor();
  assert.match(await enBlk.locator(".par .par-text").innerText(), /[؀-ۿ]{3}/);
  assert.match(await enBlk.locator(".par .par-head").innerText(), /\d+(–\d+)?\. oldal/);
  const before = await enBlk.locator(".par .par-text > div").count();
  await enBlk.getByRole("button", { name: "‹ előtte" }).click();
  assert.equal(await enBlk.locator(".par .par-text > div").count(), before + 1);
  assert.equal(await enBlk.locator(".par .par-text > div.ctx").count(), 1);
  await shot(page, "10-arabic");
  await enBlk.getByRole("button", { name: "Bezárás" }).first().click();
  ok("a paragraph's English (same footnote markers) and Arabic (with its page and neighbours)");

  // The Arabic beside every paragraph, remembered when the page is opened again.
  await page.locator(".par-switch").getByRole("button", { name: "Arab" }).click();
  await page.locator(".blk.two .par-col").first().waitFor();
  assert.match(await page.locator(".blk.two .par-col").first().innerText(), /رسالة وإمام/);
  const blocksN = await page.locator(".blk").count();
  const filled = await page.locator(".par-col .par-text > div").count();
  assert.ok(filled > blocksN * 0.8, `${filled} Arabic paragraphs for ${blocksN}`);
  await shot(page, "11-parallel");
  await page.reload();
  await page.locator(".blk.two .par-col").first().waitFor();
  await page.locator(".pager a", { hasText: "→" }).click();
  await waitPath(page, "/k/fiqh-us-seerah/5");
  await page.locator(".blk.two .par-col", { hasText: "من الميلاد إلى البعث" }).first().waitFor();
  await page.locator(".par-switch").getByRole("button", { name: "Arab" }).click();
  await page.locator(".blk.two").first().waitFor({ state: "detached" });
  await page.goto(`${BASE}/k/muslim-home/2`);
  await page.locator(".blk:has(.md > p)").first().click();
  assert.equal(await page.getByRole("button", { name: "Angol szöveg" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Arab szöveg" }).count(), 1);
  assert.deepEqual(await page.locator(".par-switch button").allTextContents(), ["Arab"]);
  ok("the Arabic beside every paragraph, kept on reload and in the next chapter; only the versions a book has are offered");

  // The rules: the books repo's FORDITASI-ELVEK.md, as on the latest master; the edit box links to them.
  await page.locator(".blk.active").getByRole("button", { name: "Javítás" }).click();
  assert.equal(await page.locator(".tools .hint a").getAttribute("href"), "/szabalyok");
  await page.locator(".blk.active").getByRole("button", { name: "Mégse" }).click();
  commitElsewhere("FORDITASI-ELVEK.md", () => "# A fordítás szabályai\n\n## Írásjelek\n\n- Idézőjel: „…”, idézeten belül »…«.\n", "Rules");
  await page.locator(".top nav a", { hasText: "Szabályok" }).click();
  await waitPath(page, "/szabalyok");
  await page.locator(".rules h2").waitFor();
  assert.equal(await page.locator(".rules h1").textContent(), "A fordítás szabályai");
  assert.equal(await page.locator(".rules li").textContent(), "Idézőjel: „…”, idézeten belül »…«.");
  await shot(page, "16-rules");
  ok("the rules page shows the rules file of the latest master, and the edit box links to it");

  // Errors in the Arabic original: Claude adds them, a member decides on the site, Claude marks them done.
  const co = mkdtempSync(join(tmpdir(), "e2e-"));
  execFileSync("git", ["clone", "-q", BARE, co]);
  const mhSrc = readFileSync(join(co, MH), "utf8");
  const snippets = parseBlocks(mhSrc)
    .filter((b) => b.text.length > 200 && !/[*_\[\]#>]/.test(b.text))
    .map((b) => ({ index: b.index, text: b.text.slice(60, 100) }))
    .filter((x) => mhSrc.split(x.text).length === 2)
    .slice(0, 2);
  const errs = snippets.map((x, i) => ({
    path: MH,
    arabic: i ? "أبو عبادة" : "عمر بن عنبسة",
    hu_now: x.text,
    hu_fix: x.text.replace(/\S+$/, "JAVÍTVA"),
    reason: i ? "Ténybeli tévedés, a források mást mondanak." : "Egy betű különbség, elírás.",
    claude_view: i ? "fact" : "slip",
  }));
  writeFileSync(join(co, "errs.json"), JSON.stringify(errs));
  assert.match(reviewIn(co, "errors", "add", "errs.json"), new RegExp(`Added \\(block ${snippets[0].index}\\)`));
  assert.equal(reviewIn(co, "errors", "add", "errs.json").match(/Already there/g).length, 2);
  rmSync(co, { recursive: true });
  await page.locator(".top nav a", { hasText: "Az eredeti hibái" }).click();
  await waitPath(page, "/hibak");
  await page.locator(".ar-error").first().waitFor();
  assert.equal(await page.locator(".tabs a.on").textContent(), "Döntésre vár (2)");
  assert.deepEqual(await page.locator(".ar-error .ar").allTextContents(), ["عمر بن عنبسة", "أبو عبادة"]);
  assert.equal(await page.locator(".ar-error .ar").first().getAttribute("dir"), "rtl");
  assert.deepEqual(await page.locator("section > h2").allTextContents(), [
    "Claude szerint elírás",
    "Claude szerint nem elírás, hanem ténybeli tévedés",
  ]);
  assert.match(await page.locator(".ar-error .where a").first().getAttribute("href"), new RegExp(`^/k/muslim-home/\\d+#p-${snippets[0].index}$`));
  await shot(page, "17-arabic-errors");
  const card = page.locator(".ar-error").first();
  await card.locator("textarea").fill("Egyetértek.");
  await card.getByRole("button", { name: "Elírás: javítsuk jegyzet nélkül" }).click();
  await page.locator(".tabs a.on", { hasText: "Döntésre vár (1)" }).waitFor();
  assert.equal(await page.locator(".ar-error").count(), 1);
  await page.goto(`${BASE}/hibak?lap=eldontve`);
  const decided = page.locator(".ar-error");
  assert.equal(await decided.count(), 1);
  assert.equal(await decided.getByRole("button", { name: "Elírás: javítsuk jegyzet nélkül" }).getAttribute("aria-pressed"), "true");
  assert.equal(await decided.locator("textarea").inputValue(), "Egyetértek.");
  assert.match(await decided.locator(".hint").textContent(), /^Teszt Elek döntött/);
  const listedErrs = review("errors");
  assert.match(listedErrs, /\[slip, by Teszt Elek .*\][\s\S]*Comment:\n    Egyetértek\./);
  assert.match(listedErrs, /\[undecided\]/);
  const errId = /=== (\w{8})  \[slip/.exec(listedErrs)[1];
  review("errors", "done", errId);
  assert.ok(!review("errors").includes(errId));
  assert.match(review("status"), /Arabic errors: +0 decided, waiting to be carried out \(undecided 1, done 1\)/);
  await page.goto(`${BASE}/hibak?lap=atvezetve`);
  assert.match(await page.locator(".ar-error .decided").textContent(), /^Elírás: javítsuk jegyzet nélkül · Egyetértek\. · átvezetve a könyvbe$/);
  assert.equal(await page.locator(".ar-error button").count(), 0);
  ok("errors in the Arabic: added by Claude, decided with a comment on the site, listed and marked done by review.mjs");

  // Phone width and dark mode.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    storageState: await ctx.storageState(),
    colorScheme: "dark",
  });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/k/muslim-home/2`);
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
  await shot(pp, "12-phone-dark");
  await pp.evaluate(() => localStorage.setItem("parhuzamos", "ar"));
  await pp.reload();
  await pp.locator(".blk.two .par-col").first().waitFor();
  const overflowPar = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflowPar <= 0, `horizontal overflow with the Arabic ${overflowPar}px`);
  await shot(pp, "13-phone-arabic");
  await pp.goto(`${BASE}/`);
  await shot(pp, "14-phone-home");
  await pp.goto(`${BASE}/k/muslim-home/2`);
  await pp.locator(".note-fab").click();
  await pp.locator(".note-panel textarea").waitFor();
  const overflowNote = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflowNote <= 0, `horizontal overflow with the note open ${overflowNote}px`);
  await shot(pp, "15-phone-note");
  await pp.goto(`${BASE}/hibak?lap=mind`);
  await pp.locator(".ar-error").first().waitFor();
  const overflowErr = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflowErr <= 0, `horizontal overflow on the errors page ${overflowErr}px`);
  await shot(pp, "18-phone-errors");
  ok("no horizontal scrolling at phone width, also with the Arabic under the paragraphs");

  // Not a member: no access.
  const other = await browser.newPage();
  await other.goto(`${BASE}/belepes`);
  await other.fill("input[name=email]", "kivulallo@example.com");
  await other.fill("input[name=password]", "jelszo-teszt-2");
  await other.click("button.primary");
  await waitPath(other, "/nincs-hozzaferes");
  ok("a signed-in non-member is shut out");

  // Row-level security, straight against the API.
  const { c: anon } = await apiAs();
  const { data: anonRows } = await anon.from("comments").select("id");
  assert.equal(anonRows?.length ?? 0, 0);
  const outsider = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await outsider.auth.signInWithPassword({ email: "kivulallo@example.com", password: "jelszo-teszt-2" });
  const { data: outRows } = await outsider.from("comments").select("id");
  assert.equal(outRows?.length ?? 0, 0);
  const { error: outIns } = await outsider.from("comments").insert({ path: MH, block_index: 0, block_text: "x", body: "x" });
  assert.ok(outIns);
  const member = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data: login } = await member.auth.signInWithPassword({ email: "teszt@example.com", password: "jelszo-teszt-1" });
  const { error: fake } = await member
    .from("comments")
    .insert({ path: MH, block_index: 0, block_text: "x", body: "x", is_claude: true, author_id: login.user.id });
  assert.ok(fake, "a member must not post as Claude");
  const { data: mine } = await member.from("comments").select("id, body").limit(1);
  const { error: rewrite } = await member.from("comments").update({ body: "átírva" }).eq("id", mine[0].id);
  assert.ok(rewrite, "comment bodies must not be editable");
  const { error: sign } = await anon.auth.signUp({ email: "uj@example.com", password: "jelszo-uj-123" });
  assert.ok(sign, "sign-ups must be off");
  // Notes: only their author's.
  for (const c of [anon, outsider, kata.c]) {
    const { data } = await c.from("notes").select("id");
    assert.equal(data?.length ?? 0, 0, "someone else's notes must not be readable");
  }
  const { data: stolen } = await kata.c.from("notes").update({ body: "átírva" }).eq("id", myNotes[0].id).select("id");
  assert.equal(stolen.length, 0);
  const { error: forged } = await kata.c
    .from("notes")
    .insert({ path: MH, section_index: 0, section_title: "x", body: "x", author_id: login.user.id });
  assert.ok(forged, "nobody writes a note as someone else");
  const { data: mineNow } = await me.c.from("notes").select("body");
  assert.deepEqual(mineNow.map((n) => n.body), [NOTE]);
  // Errors in the Arabic: members only decide, and not once they are done.
  for (const c of [anon, outsider]) {
    const { data } = await c.from("arabic_errors").select("id");
    assert.equal(data?.length ?? 0, 0, "outsiders must not read the errors");
  }
  const { data: errRows } = await member.from("arabic_errors").select("id, applied_at").order("applied_at");
  const [doneErr, openErr] = [errRows.find((r) => r.applied_at), errRows.find((r) => !r.applied_at)];
  const { error: errIns } = await member
    .from("arabic_errors")
    .insert({ path: MH, block_index: 0, block_text: "x", arabic: "x", hu_now: "x", hu_fix: "x", reason: "x", claude_view: "slip" });
  assert.ok(errIns, "members must not add errors");
  const { error: errFix } = await member.from("arabic_errors").update({ hu_fix: "átírva" }).eq("id", openErr.id);
  assert.ok(errFix, "members must not rewrite an error");
  const { error: errName } = await member.from("arabic_errors").update({ decision: "fact", decided_name: "Valaki" }).eq("id", openErr.id);
  assert.ok(errName, "the decider's name comes from the account");
  const { data: errLate } = await member.from("arabic_errors").update({ decision: "fact" }).eq("id", doneErr.id).select("id");
  assert.equal(errLate.length, 0, "a done error can't be decided again");
  const { data: errKata } = await kata.c.from("arabic_errors").update({ decision: "fact" }).eq("id", openErr.id).select("decided_name");
  assert.deepEqual(errKata, [{ decided_name: "Kolléga Kata" }]);
  ok("RLS: outsiders see nothing, members can't post as Claude or rewrite comments, notes are private, sign-ups are off; members only decide errors");

  console.log(`\nall ${step} passed`);
} finally {
  await browser.close();
}
