# cogit-reader

The proofreading site for [islamic-books-hun](https://github.com/OMMHOA/islamic-books-hun):
invited proofreaders read the Hungarian translations, fix small things directly, and ask
questions about the translation that Claude answers. The UI is in Hungarian.

- **Reading:** every top-level directory of the books repo with a `*-HUN*.md` file is a book,
  split into chapters (`#` headings, or `##` when the book has only one `#`). Always the latest
  `master`.
- **Edits:** a paragraph edit is one commit on `master` of the books repo, authored by the
  proofreader (`Name <name@lektor.invalid>`). The server only touches the Hungarian files,
  refuses the save if the paragraph changed meanwhile, and won't let a footnote marker (¹ ²) or
  a line's Markdown prefix (`#`, `-`, `1.`) change. Every edit is logged for review.
- **English and Arabic:** the `*-ENG(-full).md` and `*-AR(-full).md` files next to a book's
  Hungarian one can be shown beside every paragraph or under one (Fiqh has both; Muslim Home
  only the Arabic, its English being a PDF). Nothing in the files says which paragraph renders
  which, so `lib/align.ts` works it out: headings level by level, then paragraphs by length,
  footnote markers, numbers and Qur'ān quotes; footnotes follow their markers. It's right
  nearly everywhere but not guaranteed, so the box under a paragraph steps to its neighbours.
- **Questions:** select words (optional), write a question; threads are stored in Supabase
  (private, unlike the public books repo). Claude answers within a few minutes (a GitHub
  workflow, setup step 6). A reply from Claude marks the thread answered; a reply from a person
  reopens it, and Claude answers that too.
- **Access:** email + password, invite-only: only accounts with `app_metadata.member` (set by
  `scripts/admin.mjs`) get in, enforced in the app and by row-level security.

## Setup

1. **GitHub:** push this repo to `OMMHOA/cogit-reader` (public is fine, there are no secrets
   in it).
2. **Supabase** ([supabase.com](https://supabase.com), free plan): new project, region
   *Central EU (Frankfurt)*. Then:
   - SQL Editor → paste `supabase/migrations/20261011000000_init.sql` → Run.
   - Authentication → Sign In / Providers → turn off **Allow new users to sign up**.
   - Project Settings → API Keys: note the project URL, the **publishable** key and the
     **secret** key.
3. **GitHub token:** Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate. Repository access: *Only select repositories* → `islamic-books-hun`;
   Permissions → Repository → **Contents: Read and write**. It expires (max. a year): when
   it does, edits stop saving until you put a new one into Vercel.
4. **Vercel** ([vercel.com](https://vercel.com), Hobby plan): Add New → Project → import
   `cogit-reader`. Before the first deploy, add the environment variables:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GITHUB_TOKEN`,
   `GITHUB_REPO=OMMHOA/islamic-books-hun`, `GITHUB_BRANCH=master`. Deploy. (The secret key
   does **not** go to Vercel.) `vercel.json` adds a daily ping so the free Supabase project
   never pauses for inactivity.
5. **This machine:** copy `.env.example` to `.env.local` and fill in the Supabase URL,
   publishable and secret keys (the GitHub lines are only needed for `npm run dev`, which
   then commits to the real repo — don't).
6. **Automatic answers:** every comment from a person starts the *Answer questions* workflow
   (`.github/workflows/answer-questions.yml`): Claude Code reads the books repo (read-only
   tools) and answers every open thread, on your Claude subscription, so there's no API bill.
   - Here: `claude setup-token` (needs Pro or Max) prints a token valid for a year.
   - GitHub → `cogit-reader` → Settings → Secrets and variables → Actions → New repository
     secret, three times: `CLAUDE_CODE_OAUTH_TOKEN` (that token), `SUPABASE_URL` and
     `SUPABASE_SECRET_KEY` (from step 2).
   - A second fine-grained GitHub token, for starting the workflow: *Only select
     repositories* → `cogit-reader`; Permissions → Repository → **Actions: Read and write**.
   - Supabase SQL Editor → paste `supabase/migrations/20261013000000_answer_trigger.sql` → Run,
     then run `select vault.create_secret('<the token>', 'github_dispatch_token');`
   - Try it: GitHub → Actions → *Answer questions* → Run workflow, or ask a question on the site.

   When a run fails (e.g. an expired token), GitHub emails you, and the questions wait for the
   next run or for `review.mjs`. To renew the Supabase-side token:
   `select vault.update_secret((select id from vault.secrets where name = 'github_dispatch_token'), '<new token>');`

## Accounts

```sh
node scripts/admin.mjs add proofreader@example.com "Név Vezetéknév"   # prints a password to send them
node scripts/admin.mjs password proofreader@example.com             # new password
node scripts/admin.mjs remove proofreader@example.com               # no access (their comments stay)
node scripts/admin.mjs list
```

Everyone can change their password on the site (click your name).

## Reviewing (Claude, from the books repo)

```sh
node ../cogit-reader/scripts/review.mjs status
node ../cogit-reader/scripts/review.mjs questions        # open threads with the paragraph (normally
                                                         # none: the workflow answers them)
node ../cogit-reader/scripts/review.mjs answer <id> "…"  # "-" reads the answer from stdin
node ../cogit-reader/scripts/review.mjs edits            # unreviewed edits as word diffs
node ../cogit-reader/scripts/review.mjs keep <id>…
node ../cogit-reader/scripts/review.mjs revert <id> "…"  # after reverting it in git and pushing
```

## Tests

```sh
npm test                 # the text logic, incl. a lossless round trip of both books and how
                         # well their English and Arabic paragraphs are matched
npx supabase start       # local Supabase in Docker (once)
test/run-e2e.sh [dir]    # browser test: fresh copy of the books repo behind a fake GitHub API,
                         # local Supabase, production build; screenshots into dir
test/run-e2e.sh --serve  # the same, without the test: the site stays up on http://127.0.0.1:3100
                         # (teszt@example.com / jelszo-teszt-1) until Ctrl-C
```
