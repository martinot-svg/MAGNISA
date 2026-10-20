do $$
declare n integer; original text; latest text;
begin
 select count(*) into n from public.document_template_versions where template_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 if n<>3 then raise exception 'Backup restored % revisions instead of 3',n;end if;
 select configuration->>'primaryColor' into original from public.document_template_versions where template_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and version_number=1;
 select configuration->>'primaryColor' into latest from public.document_templates where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 if original<>'#112233' or latest<>'#778899' then raise exception 'Backup lost template appearance data';end if;
end $$;
