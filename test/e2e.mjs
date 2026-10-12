#!/usr/bin/env node
// End-to-end test against a running site (`next start`) that uses the local Supabase and
// test/fake-github.mjs. Needs the test users from scripts/admin.mjs:
//   teszt@example.com / jelszo-teszt-1 (member), kivulallo@example.com / jelszo-teszt-2 (no access)
// Env: BASE_URL, BARE_REPO (the fake GitHub's repo), ENV_FILE (for the scripts), SHOTS (optional
// directory for screenshots).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { env } from "../scripts/env.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const BARE = process.env.BARE_REPO;
const SHOTS = process.env.SHOTS;
const MH = "muslim-home/MuslimHome-Muhammad-Salih-al-Munajjid-HUN.md";
const git = (...args) => execFileSync("git", ["--git-dir", BARE, ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const review = (...args) =>
  execFileSync("node", [new URL("../scripts/review.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" });

// A commit made "elsewhere" (like a push from the books repo), via a throwaway clone.
function commitElsewhere(path, change, message) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"));
  try {
    execFileSync("git", ["clone", "-q", BARE, dir]);
    const file = join(dir, path);
    writeFileSync(file, change(readFileSync(file, "utf8")));
    execFileSync("git", ["-C", dir, "-c", "user.name=Books", "-c", "user.email=b@x.invalid", "commit", "-qam", message]);
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
  await page.goto(`${BASE}/javitasok`);
  assert.equal(await page.locator(".edit-item .chip").first().textContent(), "Visszaállítva");
  await page.locator(".edit-item .note", { hasText: "arab szöveget" }).waitFor();
  ok("a reverted edit shows Claude's reason under the paragraph and in the edits list");

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
  await shot(pp, "09-phone-dark");
  await pp.goto(`${BASE}/`);
  await shot(pp, "10-phone-home");
  ok("no horizontal scrolling at phone width");

  // Not a member: no access.
  const other = await browser.newPage();
  await other.goto(`${BASE}/belepes`);
  await other.fill("input[name=email]", "kivulallo@example.com");
  await other.fill("input[name=password]", "jelszo-teszt-2");
  await other.click("button.primary");
  await waitPath(other, "/nincs-hozzaferes");
  ok("a signed-in non-member is shut out");

  // Row-level security, straight against the API.
  const e = env();
  const anon = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
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
  ok("RLS: outsiders see nothing, members can't post as Claude or rewrite comments, sign-ups are off");

  console.log(`\nall ${step} passed`);
} finally {
  await browser.close();
}
