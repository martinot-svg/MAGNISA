-- =====================================================================
-- Supabase security & performance audit — corrected, ready-to-run
-- =====================================================================
-- Structure :
--   PART A  (transactionnel)  : REVOKE, search_path, RLS, GRANT
--   PART B  (hors transaction): CREATE INDEX CONCURRENTLY (FK manquants)
-- =====================================================================
-- ⚠️  CREATE INDEX CONCURRENTLY ne peut PAS s'exécuter dans BEGIN/COMMIT.
--     C'est le conflit principal du script original : les deux parties
--     sont donc séparées.
-- =====================================================================


-- =====================================================================
-- PART A — Changements transactionnels
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- A.1  Fonctions trigger : retirer EXECUTE côté client.
--      PUBLIC ⊇ anon ∪ authenticated → un seul REVOKE suffit.
--      L'invocation par un trigger ne dépend pas de ce grant (résolu
--      contre le propriétaire de la fonction), donc c'est sans risque.
-- ---------------------------------------------------------------------
revoke all on function public.audit_payroll_rule_change()         from public;
revoke all on function public.capture_document_appearance()       from public;
revoke all on function public.capture_document_template_version() from public;
revoke all on function public.payroll_compute_fmfp_on_insert()    from public;

-- À ADAPTER : ajoutez ici les autres fonctions trigger de la liste
-- tronquée (votre message s'arrête à `revoke all on f…`). Modèle :
--   revoke all on function public.<autre_fn_trigger>() from public;

-- Filet de sécurité : révoque EXECUTE sur TOUTES les fonctions trigger
-- du schéma public qui ne sont pas déjà verrouillées. Idempotent.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype   -- uniquement les trigger fns
  loop
    execute format('revoke all on function %s from public', r.fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- A.2  Durcissement SECURITY DEFINER : search_path explicite.
--      Corrige le risque de hijacking non couvert par le REVOKE.
-- ---------------------------------------------------------------------
alter function public.audit_payroll_rule_change()         set search_path = pg_catalog, public;
alter function public.capture_document_appearance()       set search_path = pg_catalog, public;
alter function public.capture_document_template_version() set search_path = pg_catalog, public;
alter function public.payroll_compute_fmfp_on_insert()    set search_path = pg_catalog, public;

-- Filet de sécurité : applique un search_path sûr à toute fonction
-- SECURITY DEFINER du schéma public qui n'en a pas encore.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true                    -- SECURITY DEFINER
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c like 'search_path=%'
      )
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public', r.fn
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- A.3  Catalogue légal de référence : lecture seule, utilisateurs
--      signés uniquement.
--      ⚠️ À ADAPTER : remplacez <legal_catalogue_table> par le nom réel.
--      Les blocs sont commentés pour ne pas échouer si le nom est faux ;
--      décommentez après avoir renseigné le bon nom.
-- ---------------------------------------------------------------------
-- revoke all    on table public.<legal_catalogue_table> from anon;
-- revoke all    on table public.<legal_catalogue_table> from public;
-- grant  select on table public.<legal_catalogue_table> to   authenticated;
--
-- alter table public.<legal_catalogue_table> enable row level security;
--
-- drop policy if exists "legal_catalogue_read_authenticated"
--   on public.<legal_catalogue_table>;
-- create policy "legal_catalogue_read_authenticated"
--   on public.<legal_catalogue_table>
--   for select
--   to authenticated
--   using (true);
-- -- Aucune policy pour anon ⇒ anon bloqué même si un grant fuit.

commit;


-- =====================================================================
-- PART B — Hors transaction : index FK manquants (CONCURRENTLY)
-- =====================================================================
-- Détecte automatiquement toutes les colonnes FK du schéma public qui
-- n'ont pas d'index en position de tête, et crée l'index manquant
-- avec CONCURRENTLY (aucun verrou en écriture sur la table).
-- Idempotent : ignore les index déjà existants.
--
-- ⚠️ Ne PAS envelopper cette partie dans BEGIN/COMMIT.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  idx_name text;
begin
  for r in
    select
      con.conrelid::regclass::text              as tbl,
      a.attname                                  as col,
      n.nspname                                  as sch,
      c.relname                                  as tblname
    from pg_constraint con
    join pg_class      c on c.oid = con.conrelid
    join pg_namespace  n on n.oid = c.relnamespace
    join pg_attribute  a
      on a.attrelid = con.conrelid
     and a.attnum   = con.conkey[1]
    where con.contype  = 'f'
      and n.nspname    = 'public'
      -- pas d'index dont la 1ʳᵉ colonne est cette FK
      and not exists (
        select 1
        from pg_index i
        where i.indrelid   = con.conrelid
          and i.indkey[0]  = con.conkey[1]
      )
  loop
    -- nom d'index court et sûr (limite 63 octets côté Postgres)
    idx_name := left(
      format('idx_%s_%s_fk', r.tblname, r.col),
      63
    );

    -- CONCURRENTLY + IF NOT EXISTS : sûr et rejouable
    execute format(
      'create index concurrently if not exists %I on %s.%I (%I)',
      idx_name, r.sch, r.tblname, r.col
    );

    raise notice 'Created FK index % on %.%', idx_name, r.sch, r.tblname;
  end loop;
end $$;


-- =====================================================================
-- VÉRIFICATION POST-EXÉCUTION (lecture seule)
-- =====================================================================
-- 1) Aucune fonction trigger ne doit encore être exécutable par anon :
select p.oid::regprocedure as trigger_fn,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_can_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prorettype = 'trigger'::regtype
order by 1;

-- 2) FK du schéma public encore sans index de tête (doit renvoyer 0 ligne) :
select con.conrelid::regclass as table_name, a.attname as fk_column
from pg_constraint con
join pg_namespace n on n.oid = con.connamespace
join pg_attribute a
  on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
where con.contype = 'f'
  and n.nspname = 'public'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]
  );
