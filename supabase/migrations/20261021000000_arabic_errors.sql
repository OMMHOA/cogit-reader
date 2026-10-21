-- Errors in the Arabic original, for the user to judge on the site (/hibak): a slip of the pen
-- (a name off by a letter, a wrong digit) is corrected in the translation without a note; a
-- factual error (the author tells it differently from the sources) stays, with a translator's
-- note. Claude adds the cases (review.mjs errors add) with its own view; a member decides; Claude
-- carries the decisions into the books and marks them done (review.mjs errors done).

create table if not exists public.arabic_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path text not null,                -- the book file in the books repo
  block_index int not null,          -- the paragraph it is in, when added
  block_text text not null,
  arabic text not null,              -- the Arabic as printed
  hu_now text not null,              -- the Hungarian as it is now (with its note, if any)
  hu_fix text not null,              -- the Hungarian if it is a slip
  reason text not null,
  claude_view text not null check (claude_view in ('slip', 'fact')),
  decision text check (decision in ('slip', 'fact')),
  comment text check (char_length(comment) <= 5000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_name text,
  decided_at timestamptz,
  applied_at timestamptz             -- carried into the books; no more changes
);
create index if not exists arabic_errors_path on public.arabic_errors (path, block_index);

-- Who decided comes from the account, never from the client.
create or replace function public.set_decider() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.decided_by := case when new.decision is null then null else auth.uid() end;
    new.decided_name := case when new.decision is null then null else coalesce(
      (select u.raw_user_meta_data ->> 'name' from auth.users u where u.id = auth.uid()),
      'ismeretlen') end;
    new.decided_at := case when new.decision is null then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists arabic_errors_decider on public.arabic_errors;
create trigger arabic_errors_decider before update on public.arabic_errors
  for each row execute function public.set_decider();

alter table public.arabic_errors enable row level security;

drop policy if exists "members read arabic errors" on public.arabic_errors;
create policy "members read arabic errors" on public.arabic_errors
  for select to authenticated using (public.is_member());
drop policy if exists "members decide arabic errors" on public.arabic_errors;
create policy "members decide arabic errors" on public.arabic_errors
  for update to authenticated
  using (public.is_member() and applied_at is null)
  with check (public.is_member() and applied_at is null);

revoke all on public.arabic_errors from anon, authenticated;
grant select on public.arabic_errors to authenticated;
grant update (decision, comment) on public.arabic_errors to authenticated;
