-- Questions get answered automatically: every comment from a person starts the "Answer
-- questions" workflow of the cogit-reader repo (.github/workflows/answer-questions.yml), which
-- runs Claude Code on the books repo and posts the answers with scripts/post-answers.mjs.
-- The GitHub token that starts it (fine-grained, only cogit-reader, Actions: Read and write) is
-- kept in Vault, set once in the SQL editor:
--   select vault.create_secret('github_pat_...', 'github_dispatch_token');
-- Without that secret nothing is sent (the local database of the tests).

create extension if not exists pg_net with schema extensions;

-- pg_net sends the request after the insert commits and never fails the insert; its replies
-- are kept for a while in net._http_response.
create or replace function public.dispatch_answer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  token text := (select decrypted_secret from vault.decrypted_secrets
                 where name = 'github_dispatch_token');
begin
  if token is not null then
    perform net.http_post(
      url := 'https://api.github.com/repos/OMMHOA/cogit-reader/actions/workflows/answer-questions.yml/dispatches',
      body := '{"ref": "main"}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || token,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'cogit-reader',
        'Content-Type', 'application/json'));
  end if;
  return null;
end $$;

create or replace trigger comments_answer after insert on public.comments
  for each row when (not new.is_claude) execute function public.dispatch_answer();
