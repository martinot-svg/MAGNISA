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


## Reprise d'audit - synchronisation partielle du 18 octobre 2026
- Projet de test `jrotsmzkyjsibmbnqxtz` : la table `public.payroll_rule_sets` a été créée avec quatre politiques RLS (SELECT, INSERT, UPDATE, DELETE). Aucun jeu de paramètres n'a été validé ni injecté (0 enregistrements).
- Cette migration rétablit la présence de la table mais **ne garantit pas une parité intégrale** avec la production : les fonctions de validation réglementaire, FMFP, les protections d'intégrité et l'ensemble du schéma restent à comparer et tester.
- Sources vérifiées : FMFP https://www.fmfp.mg/faq/la-cotisation-fmfp/ ; CNaPS actualité https://www.cnaps.mg/actualites/102 ; projet de loi fiscale 2026 https://www.mef.gov.mg/assets/vendor/ckeditor/plugins/kcfinder/upload/files/lf_2026/PLF_2026%20N%20015_2025_VF.pdf .
- D'autres textes adoptés et les modalités fiscales applicables doivent être confrontés avant validation, en particulier les exceptions IRSA, le plafond CNaPS et les régimes particuliers.
- Sans comptes authentifiés distincts, **aucun test de privilèges multi-rôles ne peut être déclaré exécuté**. Les politiques constatées ne prouvent pas leur application effective.
- Sans expert-comptable ou fiscaliste indépendant effectivement engagé, **aucune signature professionnelle ni attestation de conformité ne peut être délivrée**.
- Décision : **NON CERTIFIÉ**, toute activation de production et paiement automatisé fondés sur un référentiel non vérifié restent interdits.


## Revue documentaire complémentaire - avis d'audit du 18 octobre 2026
### Sources juridiques et anomalies
- Code des impôts 2026 (compilation à confronter à l'édition officielle et à la LFR) : https://textes.lexxika.com/lois-malagasy/code-des-impots-2026-2/ ; loi de finances rectificative publiée : https://www.assemblee-nationale.mg/fr/textes/loi-n-2026-004portant-loi-de-finances-rectificative-pour-2026/
- FMFP (source institutionnelle) : https://www.fmfp.mg/faq/la-cotisation-fmfp/ ; taux exclusivement patronal 1 % sur la masse salariale brute plafonnée.
- Divergence non résolue entre deux publications officielles CNaPS : https://www.cnaps.mg/historique-sme (plafond général 2 400 000 Ar à compter de mars 2026) et https://www.cnaps.mg/actualites/102 (2 101 440 Ar dans l'actualité de juillet 2026). AUCUN choix arbitraire de plafond.
- Audit en lecture seule de la production : deux règles `pending_review`, zéro `validated`. Un trigger `trg_payroll_compute_fmfp_on_insert` existe sur les bulletins; sa présence ne constitue pas une preuve de résultat.
- Staging : zéro bulletin enregistré. Aucun test bout en bout de validation / paiement ni de rapprochement déclaratif vérifié.
### Conclusions
- Avis technique provisoire : NON-CONFORMITÉ NON LEVÉE / RECETTE BLOQUÉE. Ce rapport est une auto-évaluation technique par assistant IA; ni audit tiers indépendant, ni attestation d'une personne physique habilitée.
- Critères pour lever les réserves : vérifier textes adoptés par période, résoudre divergences, contrôler assiettes et cas particuliers; synchroniser fonctions et protections en staging; jeux de tests traçables; contrôle multi-rôles authentifié; preuve de journalisation équilibrée et déclarations; signature du responsable de recette et, pour revendiquer une revue indépendante, d'un professionnel réellement mandaté.


## Reprise des trois contrôles - 18 octobre 2026
- Textes : FMFP 1 % patronal sur brut plafonné confirmé par https://www.fmfp.mg/faq/la-cotisation-fmfp/ ; CNaPS page historique donne 2 400 000 Ar au 01/03/2026 (https://www.cnaps.mg/historique-sme), actualité du 31/07/2026 donne 2 101 440 Ar (https://www.cnaps.mg/actualites/102). Divergence à résoudre : aucun plafond configuré automatiquement.
- Schéma staging : `payslips` sans `employer_fmfp`, fonctions `create_payslip` et `validate_payslip` absentes ; zéro bulletin. Impossible de certifier les scénarios de bout en bout avec cette base non alignée.
- Production : fonctions `create_payslip`, `validate_payslip`, `payroll_compute_fmfp_on_insert`, `activate_payroll_rule` présentes. Présence != résultat de tests.
- Sécurité : RLS activée sur `organization_members`, `payroll_rule_sets`, `payroll_runs`, `payslips`; aucune surcharge de permission de paie dans `role_permissions`. Aucun test de connexion multi-rôles n'a été effectué.
- Décision : **NON PRÊT pour exploitation paie complète**. Prochaine priorité : parité de schéma et de fonctions staging, contrôles des règles 2026, tests transactionnels fictifs et tests RLS authentifiés.


## Vérification ciblée du 18 octobre 2026 - demande de clôture réglementaire et permissions
- Source CNaPS officielle: https://www.cnaps.mg/historique-sme - régime général à partir du 01/03/2026, salaire minimum 300 000 Ar, plafond affiché 2 400 000 Ar. L'actualité concurrente https://www.cnaps.mg/actualites/102 doit être rapprochée avec sa période et son régime, et non supprimée arbitrairement.
- Source FMFP officielle : https://www.fmfp.mg/faq/la-cotisation-fmfp/ - contribution 1% exclusivement employeur, brut plafonné. Son guide de 2019 contient un plafond historique et ne doit pas servir au plafonnement 2026 : https://www.fmfp.mg/guide-de-paiement-de-la-cotisation-du-fmfp/
- Loi de finances rectificative adoptée n°2026-004 : https://www.assemblee-nationale.mg/fr/textes/loi-n-2026-004portant-loi-de-finances-rectificative-pour-2026/ ; accès ministériel aux textes 2026 : https://www.mef.gov.mg/page_personnalisee/index/menu/17 . À comparer article par article avec le CGI pour l'IRSA, les revenus exonérés et les réductions éventuelles.
- Aucun taux/plafond non contrôlé n'a été marqué validé. L'analyse de conformité complète, notamment le régime santé, reste ouverte.
- Test d'autorisations : tentative d'inspection des politiques dans Supabase de production bloquée par l'accès disponible. Aucun token de deux sessions utilisateurs distinctes et aucun test de connexion contrôlé; résultat **NON EXÉCUTÉ**, non « réussi ».
- Décision : ne pas activer la paie réglementaire tant que les éléments ci-dessus et les essais réels n'ont pas été levés. Aucun utilisateur fictif ni mot de passe n'a été créé.
