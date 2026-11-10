# Production Supabase migration history — reconciliation gate

## Read-only comparison performed 2026-11-10

Project: `pmlzirobpdlzsrvtkvir`  
Repository: `martinot-svg/MAGNISA`  
Production migration ledger: `supabase_migrations.schema_migrations` via the Supabase migration listing API  
Repository source: `main:supabase/migrations`

| Measure | Result |
|---|---:|
| Remote migration ledger rows | 186 |
| Timestamped SQL files in repository | 139 |
| Exact version and name matches | 49 |
| Same version, different name | 2 |
| Remote versions with no same-version local file | 135 |
| Local timestamped versions absent from remote ledger | 88 |
| Reconciliation manifest rows | 0 |

A filename-based comparison found 66 remote rows with a direct candidate among 64 local timestamped files. That is a candidate relationship only, not proof that the SQL content executed in production is identical. The remaining remote rows include the historical 0001–0023 chain, recovered migrations, production-specific migration names, and repeated names. They require evidence-based reconciliation.

## Why production deployment is blocked

The production workflow runs the migration-history guard and then `supabase db push --include-all`. The guard correctly fails closed when remote history is not represented locally, when names differ without an approved mapping, or when local-only timestamped migrations are not explicitly allowlisted.

Blindly allowlisting all 88 local-only versions would be unsafe: some may be renamed copies of migrations already applied under different remote versions. The Supabase CLI would attempt to execute the local-only versions unless their history is reconciled through a verified process. Reapplying DDL or data migrations without confirming idempotence and prior effects could damage production.

The manifest `production-history-reconciliation.tsv` is intentionally left unchanged until each row has:
- an exact local SQL representation or a recovered/absorbed representation;
- a reviewed mapping type (`renamed`, `absorbed`, or `recovered`);
- a non-empty evidence reference;
- a SHA-256 matching the referenced local file.

The pending allowlist contains the five pre-existing pending migrations plus the five new balance-sheet asset migrations from this branch. It does not approve the other unreviewed local-only versions.

## Safe release rule

Do not merge or run the production `db push` while the history guard reports unmapped remote versions, unexplained name mismatches, or unreviewed local-only versions. Do not disable the guard, fabricate manifest evidence, or bulk-allowlist migrations to obtain a green check.

The asset migrations are additive and have passed only the repository's local migration replay when the corresponding CI run is green. They have **not** been applied to production. Production release still requires a complete history reconciliation, verified backup/restore point, authenticated functional acceptance, and a controlled migration/deployment window.
