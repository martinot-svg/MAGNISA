-- Only synthetic fixture rows in ephemeral GitHub Actions PostgreSQL.
insert into private.magnisa_signup_age_pending(email,birth_date,majority_confirmed_at,expires_at)
values ('template-backup@magnisa.test',date '1990-01-01',now(),now()+interval '15 minutes');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
values ('44444444-4444-4444-8444-444444444444','template-backup@magnisa.test',now(),now(),now(),'{}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb);
insert into public.organizations(id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.organization_members(organization_id,user_id,status,role) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','44444444-4444-4444-8444-444444444444','active','owner');
insert into public.document_templates(id,organization_id,document_type,name,configuration,is_default)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','invoice','QA-Backup','{"primaryColor":"#112233"}',true);
update public.document_templates set configuration='{"primaryColor":"#445566"}' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
update public.document_templates set configuration='{"primaryColor":"#778899"}' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
