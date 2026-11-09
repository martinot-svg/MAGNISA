-- The append-only CRM journal records explicit stage transitions.
alter table public.prospect_intervention_history
  drop constraint if exists prospect_intervention_history_action_check;

alter table public.prospect_intervention_history
  add constraint prospect_intervention_history_action_check
  check (action = any (array[
    'created'::text,
    'validated'::text,
    'rejected'::text,
    'transferred'::text,
    'reassigned'::text,
    'status_changed'::text
  ]));
