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
- **Questions:** select words (optional), write a question; threads are stored in Supabase
  (private, unlike the public books repo). A reply from Claude marks the thread answered; a
  reply from a person reopens it.
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
node ../cogit-reader/scripts/review.mjs questions        # open threads with the paragraph
node ../cogit-reader/scripts/review.mjs answer <id> "…"  # "-" reads the answer from stdin
node ../cogit-reader/scripts/review.mjs edits            # unreviewed edits as word diffs
node ../cogit-reader/scripts/review.mjs keep <id>…
node ../cogit-reader/scripts/review.mjs revert <id> "…"  # after reverting it in git and pushing
```

## Tests

```sh
npm test                 # the text logic, incl. a lossless round trip of both books
npx supabase start       # local Supabase in Docker (once)
test/run-e2e.sh [dir]    # browser test: fresh copy of the books repo behind a fake GitHub API,
                         # local Supabase, production build; screenshots into dir
```
