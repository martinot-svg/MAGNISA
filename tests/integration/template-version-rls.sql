-- Runs only against temporary PostgreSQL in GitHub Actions; rollback prevents fixture persistence.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.organizations(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.organization_members(organization_id,user_id,status,role) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','active','owner'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','active','owner'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','active','viewer');
insert into public.document_templates(id,organization_id,document_type,name,configuration,is_default)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invoice','Défaut','{"primaryColor":"#123456"}',true);
update public.document_templates set configuration='{"primaryColor":"#654321"}' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.document_templates set lifecycle_status='in_review' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.document_templates set lifecycle_status='published' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.document_templates set lifecycle_status='archived',archived_at=now() where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.document_templates set lifecycle_status='draft',archived_at=null where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
-- Restoring the historical value creates a *new* revision without overwriting any old revision.
update public.document_templates set configuration=(select configuration from public.document_template_versions where template_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' and version_number=1) where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare n integer; first_color text; last_color text; state text;
begin
 select count(*),min(configuration->>'primaryColor') filter(where version_number=1),max(configuration->>'primaryColor') filter(where version_number=7)
 into n,first_color,last_color from public.document_template_versions where template_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if n<>7 or first_color<>'#123456' or last_color<>'#123456' then raise exception 'Version restore failure: n %, before %, after %',n,first_color,last_color; end if;
 select lifecycle_status into state from public.document_templates where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 if state<>'draft' then raise exception 'Status regression: %',state;end if;
end $$;
grant select on public.document_template_versions to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare n integer;
begin
 select count(*) into n from public.document_template_versions where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if n<>0 then raise exception 'Tenant isolation violated: % rows visible',n;end if;
 begin
  update public.document_template_versions set lifecycle_status='published' where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'History unexpectedly writable';
 exception when insufficient_privilege then null;
 end;
end $;
-- Same-organization reader must not see the protected history.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $ declare n integer; begin
 select count(*) into n from public.document_template_versions where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if n<>0 then raise exception 'Intra-tenant reader bypassed history permission';end if;
end $;
-- The authorized owner may read all retained revisions.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $ declare n integer; begin
 select count(*) into n from public.document_template_versions where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if n<>7 then raise exception 'Authorized owner cannot read historical revisions: %',n;end if;
end $;
rollback;
