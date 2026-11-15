# MAGNIBOX — architecture de messagerie Internet native

## Décision produit

MAGNIBOX fournit son propre service de courrier Internet. Aucun fournisseur SaaS de transport (Resend, SendGrid, Mailgun, Amazon SES ou équivalent) ne constitue une dépendance d'envoi ou de réception. Les adresses publiques restent celles des organisations et utilisateurs : `nom@domaine.tld`.

Cette décision ne signifie pas que MAGNISA devient bureau d'enregistrement de domaines. L'organisation choisit et possède son domaine auprès du registrar de son choix ; MAGNIBOX contrôle les preuves DNS et exploite le transport de courrier.

## Séparation des responsabilités

- **Application MAGNISA / Vercel** : authentification, organisations, boîtes, autorisations, interface, API métier, quotas, recherche et historique. Elle ne doit pas héberger un daemon SMTP/IMAP persistant.
- **Infrastructure MAGNIBOX dédiée** : réception SMTP sur TCP/25, soumission authentifiée sur TCP/587 (et éventuellement 465), livraison sortante SMTP, files persistantes, retry contrôlé, bounce/DSN, journaux et métriques.
- **Accès aux boîtes** : API interne sécurisée pour l'application, stockage durable des messages et pièces jointes, indexation, synchronisation et notifications. IMAP peut être proposé comme protocole de compatibilité, mais ne remplace pas l'API MAGNIBOX.
- **DNS et identité** : MX, SPF, DKIM, DMARC, TLSA/DANE si retenu, PTR/rDNS de chaque IP sortante et certificats TLS. Chaque domaine est activé uniquement après vérification et tests.
- **Sécurité opérationnelle** : antispam entrant/sortant, antivirus et limites de pièces jointes, détection d'abus, réputation IP, limitation de débit, listes de blocage, protection contre l'usurpation, isolation stricte par organisation et sauvegardes restaurables.

## Architecture de référence auto-hébergée

1. **MTA entrant/sortant** : Postfix sur des hôtes dédiés, avec files persistantes et identifiants de queue corrélés aux messages MAGNIBOX.
2. **Filtrage** : Rspamd (SPF/DKIM/DMARC, réputation et antispam), antivirus en quarantaine et politique de pièces jointes.
3. **Boîtes et accès** : Dovecot pour stockage/protocoles IMAP si nécessaire, ou service de stockage/API MAGNIBOX avec indexation. Le choix final doit être validé avec les besoins de recherche, partage, quotas et archivage.
4. **Signature** : clés DKIM séparées par domaine ou organisation, stockées hors du dépôt et de la base accessible au navigateur ; rotation et révocation prévues.
5. **Observabilité** : métriques de files, taux d'acceptation, retards, rebonds, plaintes, réputation, capacité disque et disponibilité des MX ; alertes et procédure d'incident.
6. **Haute disponibilité** : au moins deux MX dans des zones distinctes à terme, sauvegardes chiffrées, tests de restauration et plan de reprise.

## Contraintes non négociables avant l'ouverture publique

- Hébergement serveur dédié avec IP publique stable et reverse DNS modifiable.
- Vérification que l'hébergeur autorise le port TCP/25 sortant et entrant ; beaucoup de clouds le bloquent.
- PTR cohérent avec le nom HELO/EHLO et enregistrements A/AAAA.
- TLS valide, SPF/DKIM/DMARC publiés, politique de bounce et désinscription/abus opérationnelle.
- Tests réels vers et depuis Gmail, Outlook et au moins un autre domaine indépendant.
- Protection anti-open-relay : aucun relais anonyme ; authentification et autorisation obligatoires pour la soumission.
- Les changements MX ne sont jamais appliqués automatiquement. MAGNIBOX affiche les valeurs DNS et avertit qu'un MX à la racine peut détourner tous les courriers entrants du fournisseur actuel. Un sous-domaine dédié peut réduire le risque.
- Le transport reste désactivé tant que les tests, la surveillance, les limites et le plan de réponse aux abus ne sont pas validés.

## Contrat applicatif cible

Les routes métier MAGNIBOX ne doivent pas connaître un fournisseur SaaS. Elles appellent une interface interne de transport, par exemple `MagniboxMailTransport`, qui soumet un message à la file SMTP interne et renvoie un identifiant de file. Les événements de livraison, retard, rejet, bounce et plainte sont consommés depuis l'infrastructure MAGNIBOX et mettent à jour l'historique.

Le statut `accepted` signifie uniquement « accepté dans la file MAGNIBOX ». Il ne signifie pas « livré ». La livraison finale doit être confirmée par les événements ou DSN du MTA distant. Les opérations d'envoi doivent être idempotentes et ne jamais renvoyer automatiquement un message lorsque le résultat est ambigu.

## Plan de réalisation

- **Étape A — socle infra** : provisionner les hôtes, IP, PTR, stockage, réseau, pare-feu, sauvegardes et supervision ; documenter les responsabilités d'exploitation.
- **Étape B — transport natif** : déployer MTA, filtrage, DKIM, TLS, files, soumission authentifiée, réception et traitement des DSN.
- **Étape C — intégration MAGNISA** : remplacer l'adaptateur fournisseur par l'adaptateur interne ; sécuriser les API de provisioning, lecture et envoi ; conserver RLS et séparation des organisations.
- **Étape D — expérience utilisateur** : boîte de réception, dossiers, recherche, rédaction, réponses, pièces jointes, statuts et gestion des domaines.
- **Étape E — validation progressive** : tests en environnement isolé, tests aller-retour externes, pilote sur un sous-domaine, puis activation explicite par domaine.

## État actuel et limites

Le dépôt contient des tables d'identités/messages Internet et un adaptateur Resend historique. Cela ne constitue pas un serveur de messagerie auto-hébergé. La présente décision documente la cible et interdit de présenter le transport externe comme opérationnel. Aucun DNS, MX, PTR, serveur ou secret de production n'est modifié par ce document.

La capacité de livrer des messages directement depuis nos propres serveurs dépend d'une infrastructure réseau et d'exploitation réelle ; elle ne peut pas être obtenue par une simple modification du code Next.js.
