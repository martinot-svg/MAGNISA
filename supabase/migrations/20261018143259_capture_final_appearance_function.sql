create or replace function public.capture_document_appearance() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg jsonb; branding jsonb; typ text;
begin
 typ:=TG_ARGV[0];
 if new.status <> all(string_to_array(TG_ARGV[1],',')) then return new; end if;
 if TG_OP='UPDATE' and old.status=new.status then return new; end if;
 select to_jsonb(c) into branding from public.company_settings c where c.organization_id=new.organization_id;
 select dt.configuration into cfg from public.document_templates dt where dt.organization_id=new.organization_id and dt.document_type=typ and dt.is_default=true order by dt.updated_at desc limit 1;
 insert into public.document_appearance_snapshots(organization_id,document_type,document_id,appearance)
 values(new.organization_id,typ,new.id,jsonb_build_object('company',coalesce(branding,'{}'::jsonb),'template',coalesce(cfg,'{}'::jsonb)))
 on conflict do nothing;
 return new;
end $$;
