# MAGNISA

**Gérez mieux. Décidez mieux.**

MAGNISA est un SaaS de gestion d'entreprise orienté vente de services. Le projet utilise Next.js, TypeScript, Supabase/PostgreSQL/Auth/RLS et Vercel.

## Architecture

Le code applicatif est dans ce dépôt. Supabase fournit l'authentification, PostgreSQL, les politiques RLS et les fonctions transactionnelles. Vercel construit et déploie la branche `main`.

Les flux métier prioritaires sont :

- Prospect → Client → Service → Devis → Commande → Facture → Paiement → Trésorerie → Comptabilité.
- Fournisseur → Facture fournisseur → Dette → Paiement → Trésorerie → Comptabilité.
- Salarié → Période de paie → Bulletin → Validation → Paiement → Comptabilité.

Les données financières validées ne doivent pas être réécrites directement depuis le navigateur. Les opérations sensibles passent par des RPC PostgreSQL contrôlées par organisation et permission.

## Variables d'environnement

```env
NEXT_PUBLIC_APP_URL=https://magnisa.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://pmlzirobpdlzsrvtkvir.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<clé publishable Supabase>
```

Ne jamais placer une clé `service_role`, un mot de passe SMTP ou une clé privée dans le dépôt.

## Authentification

Le parcours cible est :

Inscription → email non vérifié → OTP email 6 chiffres → vérification → onboarding entreprise → session.

Pour que l'email contienne réellement le code à 6 chiffres, le template de confirmation Supabase doit utiliser le jeton OTP (par exemple `{{ .Token }}`) et le SMTP de production doit être configuré dans Supabase Auth.

## Déploiement

La branche `main` est connectée au projet Vercel `magnisa`. Chaque commit sur `main` déclenche un build de production. Un changement n'est considéré comme validé qu'après build TypeScript réussi et vérification fonctionnelle.

## Sécurité

- Multi-tenant par `organization_id`.
- Row Level Security activée sur les tables métier.
- RBAC avec permissions d'action et de lecture.
- Écritures financières sensibles via fonctions transactionnelles.
- Journal d'audit pour les opérations critiques.
- Aucune donnée de démonstration injectée en production.

## Statut

Le projet est activement durci pour la production. Un build réussi ne signifie pas à lui seul que l'ensemble de la recette fonctionnelle, réglementaire, email et navigateur est terminé.
