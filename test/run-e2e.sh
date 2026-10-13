#!/usr/bin/env bash
# The whole end-to-end run on this machine: local Supabase (npx supabase start) must be up.
# Makes a fresh bare copy of the books repo, empties the tables, (re)creates the test users,
# builds and starts the site against the fake GitHub, runs test/e2e.mjs, stops everything.
# With --serve it runs no test and leaves the site up for trying it by hand (Ctrl-C stops it):
# edits go to the throwaway copy, never to the real books repo.
#   test/run-e2e.sh [screenshot-dir]
#   test/run-e2e.sh --serve
set -euo pipefail
cd "$(dirname "$0")/.."
WORK=$(mktemp -d)
SERVE=$([ "${1:-}" = --serve ] && echo 1 || true)
SHOTS=$([ -z "$SERVE" ] && echo "${1:-}" || true)
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT

for port in 3100 4010; do
  if curl -s -o /dev/null -m 1 "http://127.0.0.1:$port/"; then echo "port $port is in use"; exit 1; fi
done
git clone -q --bare ../islamic-books-hun "$WORK/books.git"
cat > "$WORK/env" <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(npx supabase status -o json 2>/dev/null | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).PUBLISHABLE_KEY))')
SUPABASE_SECRET_KEY=$(npx supabase status -o json 2>/dev/null | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).SECRET_KEY))')
GITHUB_API_URL=http://127.0.0.1:4010
GITHUB_TOKEN=test
GITHUB_REPO=OMMHOA/islamic-books-hun
GITHUB_BRANCH=master
EOF
export ENV_FILE="$WORK/env"
docker exec supabase_db_cogit-reader psql -qU postgres -c \
  "truncate public.comments, public.edits; delete from auth.users where email like '%@example.com';"
node scripts/admin.mjs add teszt@example.com "Teszt Elek" jelszo-teszt-1 >/dev/null
node scripts/admin.mjs add kivulallo@example.com "Kívülálló" jelszo-teszt-2 >/dev/null
node scripts/admin.mjs remove kivulallo@example.com >/dev/null

node test/fake-github.mjs "$WORK/books.git" 4010 >/dev/null &
set -a; . "$WORK/env"; set +a
node_modules/.bin/next build >/dev/null
node_modules/.bin/next start -p 3100 >"$WORK/next.log" 2>&1 &
for _ in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:3100/belepes && break; sleep 0.5; done

if [ -n "$SERVE" ]; then
  echo "http://127.0.0.1:3100 — teszt@example.com / jelszo-teszt-1 (Ctrl-C stops it)"
  wait
fi
BARE_REPO="$WORK/books.git" SHOTS="$SHOTS" node test/e2e.mjs || { tail -30 "$WORK/next.log"; exit 1; }
