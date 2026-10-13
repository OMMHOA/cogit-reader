-- Personal notes on a paragraph, not only on a chapter: anchored like a question, by the
-- paragraph's index and text when the note was last saved (lib/blocks.ts, locateAnchor).
-- A chapter's note has neither. Still seen only by its author, and read by no script.

alter table public.notes add column if not exists block_index int;
alter table public.notes add column if not exists block_text text;
alter table public.notes drop constraint if exists notes_anchor;
alter table public.notes add constraint notes_anchor check ((block_index is null) = (block_text is null));

grant update (block_index, block_text) on public.notes to authenticated;
