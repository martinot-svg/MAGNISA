# Production Supabase migration history — controlled release gate

## Read-only reconciliation snapshot — 26 November 2026

- Supabase project: `pmlzirobpdlzsrvtkvir`
- Repository: `martinot-svg/MAGNISA`
- Remote ledger: `supabase_migrations.schema_migrations`
- Local source: `main:supabase/migrations` plus the integrated release branch

| Measure | Result |
|---|---:|
| Remote migration ledger rows | 268 |
| Top-level timestamped SQL files in the integrated release branch | 273 |
| Exact version and name matches | 260 |
| Same version with a different name | 6 |
| Remote-only versions | 2 |
| Historical reconciliation manifest rows | 14 |
| Local-only versions before allowlist/replay-only classification | 5 |
| Explicit replay-only versions | 1 |
| Forward migrations approved for this release | 4 |

The six name mismatches and two remote-only historical versions are represented by checksum-verified entries in `production-history-reconciliation.tsv`. The remaining five local-only versions consist of one intentionally replay-only historical migration and four forward migrations explicitly listed in the production allowlist.

## Four forward migrations in this release

| Version | Purpose |
|---|---|
| `20261126110000` | MAGNIBOX sent-folder and internal mailbox permission consistency |
| `20261126220000` | MAGNISA username rules and signup identity alignment |
| `20261127000000` | Secure organization invitation acceptance |
| `20261129000000` | Permission-aware company settings read model |

The allowlist retains previously reviewed versions for auditability. The release script verifies and skips versions already present in the production ledger; it applies only pending, allowlisted local versions. No unreviewed local-only migration is implicitly included.

## Production release safeguards

1. `scripts/ci/check-production-migration-history.sh` must pass. It checks remote/local version and name coverage, explicit historical mappings, out-of-order migrations, replay-only exclusions, and pending allowlist coverage.
2. `scripts/ci/apply-production-allowlist.sh dry-run` validates the exact allowlist and file hashes without changing production.
3. The encrypted backup workflow captures the production database, restores it to an isolated PostgreSQL instance, applies the same allowlist to that disposable restore, and verifies the accounting controls plus the MAGNIBOX, identity, invitation, and company-settings schema contracts.
4. The production apply workflow requires a successful backup artifact for the exact commit. On a main-branch push, the apply workflow is triggered after the matching backup succeeds; a manual `APPLY` dispatch is also supported.
5. The production post-apply checks verify all 17 release migration versions and the new functions, RLS policies, view grants, and invitation constraints.

## Non-negotiable safety rule

**Never run `supabase db push --include-all` while the historical ledger is not fully reconciled.** Do not disable the guard, fabricate evidence, bulk-allowlist unknown migrations, or replay the historical archive files.

The controlled allowlist path is not a claim that every historical migration has been replayed from the repository. It applies only the four forward migrations approved above, after exact backup/restore verification. The full-history guard remains active and fail-closed.
