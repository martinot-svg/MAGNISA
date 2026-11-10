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

The full-history guard correctly fails closed when remote history is not represented locally, when names differ without an approved mapping, or when local-only timestamped migrations are not explicitly allowlisted. The Supabase CLI also refuses a subset push when remote-only history rows are missing locally, even if a temporary project contains only reviewed files. That behavior was confirmed by the production preflight logs; no production SQL ran during the failed preflight.

Blindly allowlisting all 88 local-only versions would be unsafe: some may be renamed copies of migrations already applied under different remote versions. The Supabase CLI would attempt to execute the local-only versions unless their history is reconciled through a verified process. Reapplying DDL or data migrations without confirming idempotence and prior effects could damage production.

The manifest `production-history-reconciliation.tsv` is intentionally left unchanged until each row has:
- an exact local SQL representation or a recovered/absorbed representation;
- a reviewed mapping type (`renamed`, `absorbed`, or `recovered`);
- a non-empty evidence reference;
- a SHA-256 matching the referenced local file.

The pending allowlist contains five pre-existing pending migrations, five balance-sheet/asset migrations, and one source-specific PCG 606 supplier-invoice correction (11 exact versions in total). It does not approve the other unreviewed local-only versions.

## Safe release rule

The full-history guard remains fail-closed. **Never run `supabase db push --include-all` from the repository root** while the 135 remote-only rows, name mismatches, and unreviewed local-only versions remain unresolved. Do not disable the guard, fabricate manifest evidence, or bulk-allowlist the remaining migrations.

A separate controlled release path is implemented for the exact versions in `production-pending-allowlist.txt`:

- `scripts/ci/apply-production-allowlist.sh` reads only the timestamped SQL files explicitly listed in the allowlist. It checks version/name mismatches and hashes each pending file.
- In `apply` mode, each migration runs through `psql` in its own transaction. The exact original version and filename-derived name are inserted into `supabase_migrations.schema_migrations` in the same transaction as the SQL. A partially completed release can be safely rerun: already-applied versions are verified and skipped.
- The encrypted backup workflow restores the production snapshot into an isolated PostgreSQL database, applies the same 11 migrations to that disposable copy, and asserts the required balance-sheet tables, receivable RPC, PCG 581 transfer mapping, FOUR-2030 PCG 606 mapping/evidence flag, posted journal balance, and exact migration ledger versions.
- The production preflight is read-only and validates the allowlist against the remote ledger. The production `APPLY` job requires a successful encrypted backup artifact for the exact commit being released, then applies only the allowlisted versions and verifies the deployed schema and accounting controls.
- The full historical migration guard remains visible and fail-closed. The runner does not repair, rewrite, or bulk-mark the 135 remote-only rows or the other 83 unreviewed local-only migrations.

This path does **not** claim that the complete historical ledger has been reconciled. It permits only the reviewed allowlist to be released without replaying the other local-only migrations. The normal full-repository `db push` remains blocked until the manifest is fully reconciled.

The asset and passif code has passed the repository's local migration replay and authenticated workflow tests. The production migration release remains pending until the new backup workflow has successfully replayed the 11 migrations against the restored snapshot and the explicit `APPLY` workflow dispatch is executed for that exact main commit.
