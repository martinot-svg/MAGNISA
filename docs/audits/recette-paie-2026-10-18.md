# MAGNISA - Procès-verbal provisoire de recette de la paie

Date : 2026-10-18
Environnement d'essai : Supabase jrotsmzkyjsibmbnqxtz (distinct de production pmlzirobpdlzsrvtkvir)
Statut : NON CERTIFIÉ - tests incomplets.

## Constats confirmés
- L'environnement de test contient les tables employees, payroll_runs, payslips et journal_entries, sans aucun bulletin de paie enregistré à la vérification.
- La table payroll_rule_sets, présente en production, manque dans l'environnement de test. Les migrations des environnements ne sont pas synchronisées : les essais complets et leurs permissions ne peuvent pas être attestés.
- Scénario de contrôle arithmétique non persistant exécuté dans le projet de test : débit 1 190 000 Ar = crédit 1 190 000 Ar, dont FMFP patronal 10 000 Ar. Il s'agit d'une égalité mathématique illustrative et NON d'une validation d'un bulletin réel ni des triggers.
- Production : aucun référentiel de paie au statut validated lors du contrôle. Les nouvelles paies réglementaires restent bloquées.
- Les utilisateurs de rôle gestionnaire de paie et administrateur n'ont PAS fait l'objet de connexions ni de tests croisés authentifiés.
- Aucune confirmation écrite d'un professionnel habilité de Madagascar n'a été reçue.

## Tests de recette à mener avant certification
1. Synchroniser les migrations Supabase de l'environnement de test avec le schéma de production, sans copie de données financières.
2. Vérifier les règles RLS et les fonctions SECURITY DEFINER pour deux identités distinctes, l'une administrateur et l'autre gestionnaire.
3. Valider de manière indépendante textes officiels, dates d'effet, assiettes, plafonds CNaPS, organisme sanitaire, FMFP, IRSA (y compris arrondis/minima/réductions).
4. Créer un jeu de paramètres signé et validé en environnement isolé ; tester tranches IRSA, plafonds et cas limites.
5. Créer un salarié fictif, une période fictive et un bulletin, le comptabiliser, contrôler somme des débits = somme des crédits, le passif FMFP, et empêcher les paiements à partir des états non autorisés.
6. Contrôler le PDF, les droits d'accès et les transmissions, sans utiliser une adresse personnelle réelle pour les essais.
7. Constituer les preuves (requêtes, résultats, dates, approbation indépendante) et obtenir les signatures du responsable technique et du réviseur fiscal.

## Décision
RECETTE REFUSÉE À CE STADE : aucune certification à 100 % possible sans essais authentifiés et validation indépendante.
Aucun référentiel réel activé, aucune paie réelle ou donnée financière de production modifiée pour cette recette.
