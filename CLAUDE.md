# cogit-reader

The proofreading site for the books repo `../islamic-books-hun` (GitHub OMMHOA/islamic-books-hun):
invited proofreaders read the Hungarian translations, edit paragraphs (each save is a commit on
its `master`) and ask questions that Claude answers from the books repo, automatically (a GitHub
workflow) or with `scripts/review.mjs`. What it does and the setup steps are in `README.md`.

## Status

Built and tested 2026-10-11 (all of `npm test` and `test/run-e2e.sh` pass), first pushed
2026-10-12. Deployed 2026-10-13 (Supabase, GitHub token, Vercel, `.env.local` all set up);
the first question from a test account was answered with `review.mjs` the same day.
Automatic answers (`.github/workflows/answer-questions.yml` + the second migration) live since
2026-10-13: a reply on the site started the workflow and Claude answered in about 1.5 minutes.
Edit marks and personal notes built 2026-10-14; the notes need the third migration
(`supabase/migrations/20261014000000_notes.sql`) pasted into the hosted project's SQL editor.

## Decisions (agreed with the user)

- One account per person, invite-only (sign-ups off; membership is `app_metadata.member`, which
  only the secret key can set — checked in the app and by RLS).
- Edits go straight to `master` and Claude reviews them afterwards (`review.mjs keep/revert`);
  no pull requests, no approval step.
- The site runs on the publishable key and the user's session; the secret key is only used by
  the scripts: locally from the git-ignored `.env.local`, in the workflow from this repo's
  Actions secrets. (The user doesn't mind it in Vercel, the site just doesn't need it.)
- Questions are answered automatically: a trigger starts the *Answer questions* workflow, which
  runs Claude Code on the user's subscription (`CLAUDE_CODE_OAUTH_TOKEN`). **No pay-per-use
  services** (Claude API key, Vercel Sandbox): the user doesn't want billing. Claude gets only
  Read/Grep/Glob and no Supabase key; a separate step posts its answers. Edits are still
  reviewed by hand with `review.mjs`.
- Personal notes (`notes` table) are private to their author: RLS allows only them, and nothing
  else may read the table — not `review.mjs`, not the workflow, not Claude in a review. Keep it
  that way; the UI promises it ("sem a többi lektor, sem Claude nem olvassa").
- The UI is Hungarian, informal (*te*). Error messages in `lib/blocks.ts` too.
- An edit may only change words: same number of lines, same Markdown prefix per line, same
  footnote markers (¹ ²…), no blank lines (`checkEdit` in `lib/blocks.ts`). Everything outside
  the edited paragraph stays byte-identical.

## Working here

- **Next.js 16** differs from older versions: `proxy.ts` (not middleware), `params` and
  `searchParams` are Promises, fetch isn't cached. The docs for the installed version are in
  `node_modules/next/dist/docs` — check there rather than from memory.
- `npm run dev` with a real `GITHUB_TOKEN` commits to the real books repo. Test against the fake
  GitHub instead: `npx supabase start` once, then `test/run-e2e.sh [screenshot-dir]` (clones
  `../islamic-books-hun`, uses ports 3100 and 4010, refuses to start if they're taken).
  `npx supabase stop` afterwards. `test/run-e2e.sh --serve` is the same setup without the test,
  left running on http://127.0.0.1:3100 for trying the site by hand (teszt@example.com /
  jelszo-teszt-1; Ctrl-C stops it).
- A stray server from an aborted run: `pkill -f "next start -p 310[0]"` (the bracket keeps
  pkill from matching its own shell).
- The database schema is the migrations in `supabase/migrations/`; on the hosted project each is
  applied by pasting it into the SQL editor, on a running local one by
  `npx supabase migration up`.
- The English/Arabic matching (`lib/align.ts`) is tuned on the real books: `test/align.test.mjs`
  checks it against footnote numbers (English), marker counts and Qur'ān verse numbers
  (Arabic), and sections only the translation has. Measure any change on both books.
- To try the answering prompt without the workflow, run the `claude -p` line of the workflow
  from the books repo with `review.mjs questions` output on stdin; it only prints JSON.
