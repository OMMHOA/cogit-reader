-- Personal notes: one per proofreader and chapter, seen only by the one who wrote it. Nothing
-- else reads them: neither the scripts (review.mjs, post-answers.mjs) nor the answering workflow,
-- so Claude never sees them, and writing one starts no workflow.
-- A chapter is kept as its index and title: the chapter with that title is found again if
-- chapters are added or removed before it (lib/blocks.ts, locateSection).

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null,                -- the book file in the books repo
  section_index int not null,
  section_title text not null,
  body text not null check (char_length(body) between 1 and 20000),
  updated_at timestamptz not null default now()
);
create index if not exists notes_author on public.notes (author_id, path);

alter table public.notes enable row level security;

drop policy if exists "members keep their own notes" on public.notes;
create policy "members keep their own notes" on public.notes
  for all to authenticated
  using (public.is_member() and author_id = auth.uid())
  with check (public.is_member() and author_id = auth.uid());

revoke all on public.notes from anon, authenticated;
grant select, insert, delete on public.notes to authenticated;
grant update (section_index, section_title, body, updated_at) on public.notes to authenticated;
