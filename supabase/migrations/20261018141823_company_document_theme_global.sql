alter table public.company_settings add column if not exists document_theme jsonb not null default '{}'::jsonb;
alter table public.company_settings add constraint company_document_theme_object check (jsonb_typeof(document_theme)='object' and pg_column_size(document_theme)<8192);
