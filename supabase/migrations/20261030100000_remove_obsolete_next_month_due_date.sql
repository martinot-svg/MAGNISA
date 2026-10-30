-- Remove the legacy fixed-day fiscal due-date helper.
-- Fiscal and social obligations now use validated, organization-scoped calendar rules.
drop function if exists public.next_month_due_date(date, integer);
