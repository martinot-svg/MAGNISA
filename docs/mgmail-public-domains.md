# MGMail — domaines publics et adresses professionnelles

## Règle de base

Un administrateur peut demander une adresse personnelle ou de service,
par exemple `personnel@monentreprise.mg` ou `finance@monentreprise.com`.
Les collaborateurs liront et enverront leur courrier uniquement dans MAGNISA.

**Demander** une adresse ne donne jamais accès au courrier Internet :
- `mgmail_domain_requests` et `mgmail_public_address_requests` sont des demandes de l'entreprise.
- `mgmail_verified_domains` est la preuve fournisseur/organisation, écrite exclusivement par l'opérateur privilégié.
- `mgmail_external_identities` reste désactivée tant que la preuve et les autorisations ne sont pas présentes.

Une entreprise n'a pas l'obligation d'acheter un domaine : une adresse sur un
**domaine public appartenant déjà à MAGNISA et effectivement vérifié**
pourra lui être proposée. Cette possibilité n'implique PAS qu'un domaine
partagé soit déjà acquis ou configuré.

## Procédure sûre

1. Un responsable disposant de `users.manage` demande le domaine et
   les adresses désirées dans **MGMail → E-mails externes → Domaines et adresses**.
2. Un opérateur MAGNISA vérifie les pièces d'autorisation du domaine et
   garde une référence de preuve, sans supposer que le simple fait d'entrer
   le nom d'un tiers prouve sa propriété.
3. Le domaine ou sous-domaine est déclaré et configuré par les personnes
   légitimes chez Resend : DNS d'expédition (DKIM/SPF, politique DMARC),
   DNS de réception (MX), et capacités `sending` et `receiving`.
   Préférer un sous-domaine si le domaine principal utilise déjà un autre
   service de courrier. **Ne jamais remplacer ses MX sans procédure de migration.**
4. Sur une machine d'administration sûre, avec des secrets hors dépôt :
   - `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` : base Supabase ciblée.
   - `MGMAIL_RESEND_API_KEY` : clé fournisseur permettant la lecture du domaine.
   - `MGMAIL_OPERATOR_REFERENCE` : référence de l'opérateur.
   - `MGMAIL_OWNERSHIP_EVIDENCE_REFERENCE` : référence de preuve de propriété.
   - `node scripts/ops/mgmail-approve-public-address.mjs --request-id <UUID> --provider-domain-id <ID> --ownership-confirmed` : **prévisualisation** uniquement.
   - Ajouter `--execute` après revue : exige la confirmation `verified`
     du domaine, la concordance de nom et les DNS DKIM/SPF/MX vérifiés.
5. La base refuse une identité active si la preuve fournisseur n'est pas
   rattachée à la même organisation, si le domaine ne correspond pas ou
   si la réception est activée sans sa preuve.
6. Après activation, le responsable attribue séparément les droits de
   lecture et d'envoi aux collaborateurs dans les paramètres des boîtes.
   L'adresse ne peut être utilisée hors de MAGNISA par les salariés.

## Sécurité et limites

- La procédure d'approbation n'achète ni ne revendique aucun domaine, ne
  configure aucun DNS et n'envoie aucun message.
- Les opérateurs doivent vérifier la preuve de propriété réelle avant
  l'approbation : l'API du fournisseur confirme son infrastructure, pas la
  relation juridique entre domaine et entreprise.
- Une suspension de preuve DNS dans la base désactive immédiatement les
  identités concernées. La synchronisation régulière de l'état DNS réel
  du fournisseur reste une vérification opérationnelle nécessaire.
- Le courrier Internet reste inactif tant que les secrets nécessaires et
  le webhook signé ne sont pas configurés et testés, et tant que les
  branches en attente ne sont pas intégrées et déployées.
- Les tests CI créent une **preuve fictive en base isolée**, sans fournisseur
  Internet ni e-mail réel. Ils ne démontrent pas la délivrabilité.
- Un test aller-retour contrôlé avec Gmail/Outlook/Proton est requis avant
  toute annonce de réception externe opérationnelle.
- Ne pas activer de forfait payant ni de domaine sans décision de son propriétaire.
