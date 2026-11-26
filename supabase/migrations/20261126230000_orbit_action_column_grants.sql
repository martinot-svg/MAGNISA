-- Grant only the column operations used by Orbit Action's authenticated UI.
-- Row-level policies continue to enforce organization membership and task ownership.

GRANT INSERT (
  organization_id,
  created_by,
  title,
  description,
  priority,
  assigned_to,
  parent_task_id,
  due_date
) ON TABLE public.orbit_action_tasks TO authenticated;

GRANT UPDATE (status, updated_at)
ON TABLE public.orbit_action_tasks TO authenticated;

GRANT INSERT (
  organization_id,
  task_id,
  author_user_id,
  body
) ON TABLE public.orbit_action_comments TO authenticated;
