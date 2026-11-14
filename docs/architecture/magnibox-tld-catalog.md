# Magnibox — catalogue des extensions (IANA / NIC.MG)

## Architecture
- Entrée utilisateur : `/orbit/magnibox/extensions`, administrateurs `users.manage` uniquement.
- Liste de la racine DNS : `https://data.iana.org/TLD/tlds-alpha-by-domain.txt`, contrôlée et mise en cache 24 h.
- La table `magnibox_tld_catalog` conserve uniquement des métadonnées globales, pas des domaines enregistrés, des secrets ou des adresses personnelles.
- Une tâche hebdomadaire à travers le cron sécurisé de notifications enrichit la table sans modifier les entrées manuellement désactivées.
- Les suffixes .MG descriptifs ne sont jamais enregistrés comme TLD de la racine.
- La base refuse les écritures directes aux utilisateurs authentifiés et anonymes.
- Le catalogue et les domaines revendiqués par les entreprises sont des entités différentes : la propriété n'est confirmée que par le challenge DNS et les politiques existantes.

## Important
La présence dans IANA ne signifie ni disponibilité à l'achat, ni éligibilité commerciale, ni compatibilité de courrier démontrée.
Le contrôle de disponibilité en temps réel nécessite un fournisseur d'enregistrement disposant d'une API fiable. Aucun fournisseur n'étant connecté, le statut reste "non vérifié" et ne peut pas débloquer un domaine public.
NIC.MG confirme les zones .mg, .com.mg, .co.mg, .org.mg, .edu.mg, .gov.mg, .mil.mg, .nom.mg, .prd.mg, .tm.mg dans sa charte.
.net.mg figure à titre indicatif, marqué "non vérifié", car non confirmé dans la liste descriptive de la charte.

## Mise en service
1. Fusionner après CI complète et replay PostgreSQL 17.
2. Appliquer les migrations via le workflow de production protégé, avec sauvegarde chiffrée.
3. Vérifier `magnibox_tld_catalog`, RLS, droits et ledger.
4. Lancer le cron authentifié `/api/cron/magnibox-tld-catalog` ou laisser le cron existant lancer la synchronisation hebdomadaire.
5. Vérifier en base le nombre de suffixes, les catégories et les dates de synchronisation.
6. Tester la navigation, la recherche et l'isolement des opérations d'administration.

Sources :
- https://www.iana.org/domains/root/files
- https://data.iana.org/TLD/tlds-alpha-by-domain.txt
- https://nic.mg/wp-content/uploads/2025/04/Charte-de-nommage-du-MG-I-Domaine-name-charter-of-MG.pdf
