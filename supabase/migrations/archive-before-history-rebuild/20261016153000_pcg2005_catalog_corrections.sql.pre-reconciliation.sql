-- Rectification d'une reference du catalogue PCG 2005 annexe I p.146.
insert into public.pcg2005_accounts(code,label,kind)
values ('203','Frais de developpement immobilisables','asset'),
       ('204','Logiciels informatiques et assimiles','asset'),
       ('205','Concessions et droits similaires, brevets, licences, marques','asset'),
       ('211','Terrains','asset'),
       ('213','Constructions','asset'),
       ('120','Resultat de l''exercice (benefice)','equity'),
       ('129','Resultat de l''exercice (perte)','equity'),
       ('110','Report a nouveau solde crediteur','equity'),
       ('119','Report a nouveau solde debiteur','equity'),
       ('168','Autres emprunts et dettes assimiles','liability')
on conflict (code) do nothing;
update public.pcg2005_accounts set label='Capital'
 where code='101';
delete from public.pcg2005_accounts a where code='201'
and not exists(select 1 from public.pcg2005_account_mappings m where m.pcg_code=a.code);
