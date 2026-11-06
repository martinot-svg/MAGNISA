# Audit du calcul de paie et de l'IRSA 2026

## Conclusion vérifiée au 6 novembre 2026

Le référentiel actuellement validé de l'organisation contrôlée correspond déjà au barème IRSA 2026 : six tranches, taux marginal de 25 % au-delà de 4 000 000 Ar, minimum de 3 000 Ar et arrondi de la base à la centaine inférieure. Les taux enregistrés sont CNaPS 1 % salarié / 13 % employeur et SMIE 2 % salarié / 8 % employeur.

Les plafonds enregistrés sont toutefois de 2 400 000 Ar pour la CNaPS et de 1 600 000 Ar pour la SMIE. Aucune modification de ces plafonds n'est activée par ce correctif.

## Correctifs logiciels

- Le calcul IRSA est centralisé dans un module unique, partagé par la paie et l'aperçu du référentiel.
- La déduction fiscale de la cotisation santé du salarié est plafonnée à 1 % du salaire brut, conformément à l'article 01.03.09, 2°, du Code des impôts DGI. La retenue SMIE réellement due reste calculée au taux enregistré ; seule la déduction IRSA est plafonnée.
- Le calcul TypeScript et le déclencheur PostgreSQL utilisent la même règle.
- Un revenu imposable nul produit une retenue IRSA nulle dans les deux moteurs.
- Les validations couvrent les tranches, les bornes, l'arrondi, le minimum, les personnes à charge, les taux, les plafonds et les valeurs invalides.
- Aucune donnée de paie historique n'est recalculée par la migration préparée.

## Références légales

### Barème IRSA 2026

La loi n°2025-021 portant loi de finances pour 2026, article 01.03.16, fixe les taux marginaux suivants : 0 % jusqu'à 350 000 Ar, 5 % jusqu'à 400 000 Ar, 10 % jusqu'à 500 000 Ar, 15 % jusqu'à 600 000 Ar, 20 % jusqu'à 4 000 000 Ar, puis 25 % au-delà.

Source officielle : https://cnlegis.gov.mg/uploads/L2025-021_VF.pdf

Le minimum de perception de 3 000 Ar, la réduction de 2 000 Ar par personne à charge et l'arrondi de l'assiette sont documentés dans le Code général des impôts publié par la DGI. L'article 01.03.09, 2°, limite la déduction de la cotisation santé du salarié à 1 % du salaire brut.

Source DGI : https://portal.impots.mg/textes/textes/2025-02-06--N-2025-MEF.SG.DGI-Ref-HIH9EC-3OPLT3.pdf

### Retraite complémentaire

La loi n°2025-021 ajoute aux articles 01.03.02 et 01.03.06 les pensions de retraite complémentaire et les versements effectués par l'employeur auprès d'organismes spécialisés dans la constitution de ces pensions au champ de l'IRSA.

Le modèle de bulletin actuel ne possède pas de champ distinct pour ces versements patronaux. Si l'organisation en effectue, ils doivent être intégrés explicitement à l'assiette imposable sans être confondus avec un salaire net payé. Ce cas n'est pas certifié par le présent correctif.

### Cotisations sociales

Le talon officiel CNaPS/FMFP confirme les taux CNaPS de 13 % employeur et 1 % travailleur, ainsi que le taux FMFP de 1 % employeur :
https://www.cnaps.mg/fr/telechargement/cotisations/talonfmfp-CNaPS_600fcb8215b502.69912222.pdf

L'article 25 du décret n°2003-1162 fixe un minimum SMIE de 5 % employeur et 1 % salarié :
https://www.edbm.mg/wp-content/uploads/2017/12/Decret_2003-1162_medecine_entreprise.pdf

La configuration actuelle de l'organisation pour l'OMIT est de 8 % employeur et 2 % salarié. Elle est conservée ; son fondement contractuel doit être vérifié avant toute modification.

### Plafonds CNaPS / SMIE

La page historique officielle CNaPS affiche un plafond général de 2 400 000 Ar associé à un SME de 300 000 Ar :
https://www.cnaps.mg/historique-sme

Le CNLegis répertorie le décret n°2026-1358 et son errata du 2 octobre 2026 comme étant en vigueur. Une source professionnelle FISEMA mentionne un SME M1-1A non agricole de 315 000 Ar, soit 2 520 000 Ar à huit fois le SME. Toutefois, l'annexe officielle du décret et l'incidence exacte sur les plafonds de cotisation n'ont pas encore été obtenues et rapprochées de la page CNaPS.

En conséquence, le correctif ne remplace pas les plafonds actuels de 2 400 000 Ar et 1 600 000 Ar. Le plafond de 2 520 000 Ar reste une hypothèse à confirmer par la CNaPS et le texte officiel complet.

### Loi de finances rectificative 2026

La loi n°2026-004 a été adoptée et déclarée conforme par la HCC. Le texte intégral promulgué n'a pas encore été rapproché des articles IRSA 01.03.02, 01.03.06, 01.03.09, 01.03.16 et 01.03.19. Aucune activation réglementaire ne doit être fondée sur une simple supposition d'absence de modification.

## Conditions de mise en production

1. Faire confirmer par la CNaPS le plafond de cotisation applicable à la catégorie de l'organisation à compter du 1er octobre 2026.
2. Obtenir le contrat ou l'avis écrit justifiant les taux spécifiques OMIT de 8 % / 2 %.
3. Récupérer le texte intégral promulgué de la LFR 2026 et vérifier les dispositions IRSA.
4. Définir le traitement des versements patronaux de retraite complémentaire si l'organisation utilise ce dispositif.
5. Faire réussir les tests d'interface authentifiés et la prévisualisation Vercel du dernier commit.
6. Ne pas activer un nouveau référentiel tant que ces points ne sont pas levés.

La migration préparée corrige uniquement le calcul fiscal et son contrôle côté base de données. Elle ne modifie aucune règle validée, aucun bulletin historique et aucune donnée de production.
