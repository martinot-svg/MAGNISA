# Audit du calcul de paie et de l'IRSA 2026

## Conclusion vérifiée au 6 novembre 2026

Le référentiel actuellement validé de l'organisation contrôlée correspond déjà au barème IRSA 2026 : six tranches, taux marginal de 25 % au-delà de 4 000 000 Ar, minimum de 3 000 Ar et arrondi de l'assiette à la centaine inférieure. Les taux enregistrés sont CNaPS 1 % salarié / 13 % employeur et SMIE 2 % salarié / 8 % employeur.

Les plafonds enregistrés sont 2 400 000 Ar pour la CNaPS et 1 600 000 Ar pour la SMIE. Aucune modification de ces plafonds n'est activée par ce correctif.

## Correctifs logiciels

- Le calcul IRSA est centralisé dans un module unique, partagé par la paie et l'aperçu des référentiels.
- La déduction fiscale de la cotisation santé du salarié est plafonnée à 1 % du salaire brut, conformément à l'article 01.03.09, 2°, du Code des impôts DGI. La retenue SMIE réellement due reste calculée au taux enregistré ; seule la fraction déductible réduit l'assiette IRSA.
- Le calcul TypeScript et le déclencheur PostgreSQL utilisent la même règle.
- Un revenu imposable nul produit une retenue IRSA nulle dans les deux moteurs.
- Les versements patronaux aux régimes de retraite complémentaire sont maintenant saisis dans un champ distinct, ajoutés à l'assiette IRSA et au coût employeur, mais jamais au net payé au salarié.
- La validation comptable sépare les charges CNaPS/santé, FMFP et retraite complémentaire, avec une écriture débit/crédit équilibrée pour chaque poste.
- Les validations couvrent les tranches, les bornes, l'arrondi, le minimum, les personnes à charge, les taux, les plafonds, la retraite complémentaire et les valeurs invalides.
- Aucune donnée de paie historique n'est recalculée par les migrations préparées.

## Références légales

### Barème IRSA et retraite complémentaire

La loi n°2025-021 portant loi de finances pour 2026, article 01.03.16, fixe les taux marginaux suivants : 0 % jusqu'à 350 000 Ar, 5 % jusqu'à 400 000 Ar, 10 % jusqu'à 500 000 Ar, 15 % jusqu'à 600 000 Ar, 20 % jusqu'à 4 000 000 Ar, puis 25 % au-delà.

La même loi modifie les articles 01.03.02 et 01.03.06 afin d'inclure dans le champ IRSA les pensions de retraite complémentaire et les versements effectués par l'employeur auprès d'organismes spécialisés dans la constitution de ces pensions. Le bulletin MAGNISA traite désormais ce montant séparément du salaire brut payé.

Source officielle : https://cnlegis.gov.mg/uploads/L2025-021_VF.pdf

### Déduction santé et assiette

Le Code général des impôts publié par la DGI prévoit à l'article 01.03.09, 2°, la déduction de la cotisation ouvrière à un organisme sanitaire / assurance santé dans la limite de 1 % du salaire brut. L'article 01.03.16 prévoit l'arrondi de l'assiette imposable à la centaine inférieure. La retenue de santé réelle reste déduite du net, même lorsque sa fraction déductible est plafonnée.

Source DGI : https://portal.impots.mg/textes/textes/2025-02-06--N-2025-MEF.SG.DGI-Ref-HIH9EC-3OPLT3.pdf

### Loi de finances rectificative 2026

Le texte intégral officiel de la loi n°2026-004 a été retrouvé. Il ne modifie pas directement les articles IRSA 01.03.02, 01.03.06, 01.03.09 ou 01.03.16. Il ajoute notamment à l'article VII-32 une règle d'arrondi à la centaine inférieure de l'impôt à payer après liquidation.

Cette règle générale de recouvrement doit être rapprochée de la déclaration et du versement mensuel de l'IRSA retenu à la source. Elle n'est pas appliquée arbitrairement à chaque bulletin dans ce correctif ; le moteur conserve l'arrondi de l'assiette prévu à l'article 01.03.16.

Source officielle : https://cnlegis.gov.mg/uploads/L2026-004-VF.pdf

### Cotisations sociales

Le talon officiel CNaPS/FMFP confirme les taux CNaPS de 13 % employeur et 1 % travailleur, ainsi que le taux FMFP de 1 % employeur :
https://www.cnaps.mg/fr/telechargement/cotisations/talonfmfp-CNaPS_600fcb8215b502.69912222.pdf

L'article 25 du décret n°2003-1162 fixe un minimum SMIE de 5 % employeur et 1 % salarié :
https://www.edbm.mg/wp-content/uploads/2017/12/Decret_2003-1162_medecine_entreprise.pdf

La configuration actuelle de l'organisation pour l'OMIT est de 8 % employeur et 2 % salarié. Elle est conservée ; son fondement contractuel doit être vérifié avant toute modification.

### Plafonds CNaPS / SMIE

La page historique officielle CNaPS affiche un plafond général de 2 400 000 Ar associé à un SME de 300 000 Ar :
https://www.cnaps.mg/historique-sme

Le CNLegis répertorie le décret n°2026-1358 et son errata du 2 octobre 2026 comme étant en vigueur. Une source professionnelle FISEMA mentionne un SME M1-1A non agricole de 315 000 Ar, soit 2 520 000 Ar à huit fois le SME. Toutefois, l'annexe officielle du décret et l'incidence exacte sur les plafonds de cotisation n'ont pas encore été rapprochées de la page CNaPS.

En conséquence, le correctif ne remplace pas les plafonds actuels de 2 400 000 Ar et 1 600 000 Ar. Le plafond de 2 520 000 Ar reste à confirmer par la CNaPS et le texte officiel complet.

## Contrôle comptable du bulletin

L'audit de la production n'a trouvé aucune fiche de paie validée avec une cotisation FMFP. Les deux écritures de paie existantes sont équilibrées. La fonction de validation ne prévoyait toutefois pas de débit de charge correspondant au crédit FMFP à payer ; le nouveau code ajoute explicitement le débit FMFP. Le même principe est appliqué aux versements patronaux de retraite complémentaire.

## Conditions de mise en production

1. Faire confirmer par la CNaPS le plafond de cotisation applicable à la catégorie de l'organisation à compter du 1er octobre 2026.
2. Obtenir le contrat ou l'avis écrit justifiant les taux spécifiques OMIT de 8 % / 2 %.
3. Faire confirmer par la DGI l'application pratique de l'arrondi de l'article VII-32 à la déclaration mensuelle d'IRSA retenue à la source.
4. Réussir les tests CI, le replay Supabase propre et le test navigateur authentifié.
5. Ne pas appliquer les migrations en production avant ces validations.

Les migrations ajoutées ne modifient aucun bulletin historique et n'activent aucun référentiel réglementaire.
