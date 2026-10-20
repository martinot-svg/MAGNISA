-- Only synthetic fixture rows in ephemeral GitHub Actions PostgreSQL.
insert into auth.users(id) values ('44444444-4444-4444-8444-444444444444');
insert into public.organizations(id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.organization_members(organization_id,user_id,status,role) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','44444444-4444-4444-8444-444444444444','active','owner');
insert into public.document_templates(id,organization_id,document_type,name,configuration,is_default)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','invoice','QA-Backup','{"primaryColor":"#112233"}',true);
update public.document_templates set configuration='{"primaryColor":"#445566"}' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
update public.document_templates set configuration='{"primaryColor":"#778899"}' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
