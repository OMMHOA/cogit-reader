-- Proofreading site: comments (questions + answers) and the log of edits made on the site.
-- Access is for members only: users whose app_metadata has "member": true, which only the
-- secret key (scripts/admin.mjs) can set. Sign-ups are also switched off in the dashboard.

create or replace function public.is_member() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'member')::boolean, false)
$$;

-- A thread is a root comment (anchored to a paragraph) plus its replies.
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path text not null,                -- the book file in the books repo
  parent_id uuid references public.comments (id) on delete cascade,
  block_index int,                   -- root only: where the paragraph was
  block_text text,                   -- root only: the paragraph as it was
  quote text,                        -- root only: the selected words, if any
  body text not null check (char_length(body) between 1 and 5000),
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  is_claude boolean not null default false,
  status text not null default 'open' check (status in ('open', 'answered', 'resolved')),
  check ((parent_id is null) = (block_text is not null and block_index is not null))
);
create index comments_path on public.comments (path, created_at);
create index comments_parent on public.comments (parent_id);

create table public.edits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path text not null,
  block_index int not null,
  old_text text not null,
  new_text text not null,
  commit_sha text not null,
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'kept', 'reverted')),
  note text
);
create index edits_created on public.edits (created_at desc);

-- Names come from the user's account, never from the client.
create or replace function public.set_author_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.author_name := coalesce(
      (select u.raw_user_meta_data ->> 'name' from auth.users u where u.id = auth.uid()),
      'ismeretlen');
  end if;
  return new;
end $$;

create trigger comments_author before insert on public.comments
  for each row execute function public.set_author_name();
create trigger edits_author before insert on public.edits
  for each row execute function public.set_author_name();

-- A reply from Claude marks the thread answered; a reply from a person reopens it.
create or replace function public.reply_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null then
    update public.comments
       set status = case when new.is_claude then 'answered' else 'open' end
     where id = new.parent_id;
  end if;
  return new;
end $$;

create trigger comments_reply after insert on public.comments
  for each row execute function public.reply_status();

alter table public.comments enable row level security;
alter table public.edits enable row level security;

create policy "members read comments" on public.comments
  for select to authenticated using (public.is_member());
create policy "members add comments" on public.comments
  for insert to authenticated
  with check (public.is_member() and author_id = auth.uid() and not is_claude and status = 'open');
create policy "members open or close threads" on public.comments
  for update to authenticated
  using (public.is_member() and parent_id is null)
  with check (public.is_member() and status in ('open', 'resolved'));

create policy "members read edits" on public.edits
  for select to authenticated using (public.is_member());
create policy "members log their edits" on public.edits
  for insert to authenticated
  with check (public.is_member() and author_id = auth.uid() and status = 'pending' and note is null);

revoke all on public.comments, public.edits from anon, authenticated;
grant select, insert on public.comments to authenticated;
grant update (status) on public.comments to authenticated;
grant select, insert on public.edits to authenticated;

-- Called daily by the Vercel cron so the free Supabase project is never paused for inactivity.
create or replace function public.ping() returns timestamptz
language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon;
