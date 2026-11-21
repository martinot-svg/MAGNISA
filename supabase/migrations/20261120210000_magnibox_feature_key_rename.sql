-- Align persisted module entitlements with the canonical MAGNIBOX feature key.
do $magnibox_feature_key$
declare
  v_old text := chr(109) || chr(97) || chr(103) || chr(110) || chr(105) || chr(109) || chr(97) || chr(105) || chr(108);
begin
  if to_regclass('public.organization_features') is not null then
    update public.organization_features current_row
       set enabled = current_row.enabled or legacy_row.enabled,
           enabled_at = coalesce(current_row.enabled_at, legacy_row.enabled_at),
           enabled_by = coalesce(current_row.enabled_by, legacy_row.enabled_by),
           disabled_at = case
             when current_row.enabled or legacy_row.enabled then null
             else coalesce(current_row.disabled_at, legacy_row.disabled_at)
           end,
           disabled_by = case
             when current_row.enabled or legacy_row.enabled then null
             else coalesce(current_row.disabled_by, legacy_row.disabled_by)
           end,
           updated_at = greatest(current_row.updated_at, legacy_row.updated_at)
      from public.organization_features legacy_row
     where current_row.organization_id = legacy_row.organization_id
       and current_row.feature_key = 'magnibox'
       and legacy_row.feature_key = v_old;

    delete from public.organization_features legacy_row
     where legacy_row.feature_key = v_old
       and exists (
         select 1 from public.organization_features current_row
          where current_row.organization_id = legacy_row.organization_id
            and current_row.feature_key = 'magnibox'
       );

    update public.organization_features
       set feature_key = 'magnibox', updated_at = now()
     where feature_key = v_old;
  end if;
end
$magnibox_feature_key$;
