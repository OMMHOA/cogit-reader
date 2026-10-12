# cogit-reader

The proofreading site for the books repo `../islamic-books-hun` (GitHub OMMHOA/islamic-books-hun):
invited proofreaders read the Hungarian translations, edit paragraphs (each save is a commit on
its `master`) and ask questions that Claude answers from the books repo with
`scripts/review.mjs`. What it does and the setup steps are in `README.md`.

## Status

Built and tested 2026-10-11 (all of `npm test` and `test/run-e2e.sh` pass), first pushed
2026-10-12. **Not deployed yet**: the README's setup steps 2–5 (Supabase project in Frankfurt,
fine-grained GitHub token, Vercel project + env vars, `.env.local`) are the user's to do in the
web consoles; then add the first accounts with `scripts/admin.mjs`.

## Decisions (agreed with the user)

- One account per person, invite-only (sign-ups off; membership is `app_metadata.member`, which
  only the secret key can set — checked in the app and by RLS).
- Edits go straight to `master` and Claude reviews them afterwards (`review.mjs keep/revert`);
  no pull requests, no approval step.
- The Supabase **secret key never goes to Vercel**: the site runs on the publishable key and the
  user's session; only the local scripts use the secret key, from the git-ignored `.env.local`.
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
  `npx supabase stop` afterwards.
- A stray server from an aborted run: `pkill -f "next start -p 310[0]"` (the bracket keeps
  pkill from matching its own shell).
- The database schema is the one migration in `supabase/migrations/`; on the hosted project it
  is applied by pasting it into the SQL editor.
