-- Marketing Agent projects: a project gathers generations like a folder (name, pin, creation time and the job ids in
-- it), stored as a fourth kind of library item next to products, ad references and favourites. Data is checked by
-- core/marketing-library.ts; only the allowed kinds change here.
alter table marketing_items drop constraint marketing_items_kind_check;
alter table marketing_items add constraint marketing_items_kind_check check (kind in ('product', 'reference', 'favorite', 'project'));
