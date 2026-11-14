# MGMail — canal Internet via Resend (lot initial)

Ce lot ajoute une option d'envoi et de réception **sans Gmail ni connexion Google obligatoire**. Il coexiste avec l'intégration Gmail existante. **Il n'active aucun domaine automatiquement**, et aucune adresse `.mail`/`.mgmail` interne ne devient une véritable adresse Internet.

## Conditions indispensables pour un vrai échange client ↔ MGMail

1. Vérifier qu'un domaine public appartient à l'entreprise, ou à MAGNISA lorsqu'un domaine partagé est utilisé. Un domaine `mitalia.digital` ne peut être attribué que si Mitalia en détient le droit d'utilisation. Le client MAGNISA n'a pas l'obligation d'acheter un domaine : un sous-domaine public légitimement géré par MAGNISA peut être proposé après configuration de l'infrastructure.
2. Configurer ce domaine chez Resend, **vérifier l'authentification d'expédition** (SPF, DKIM et DMARC), les MX de réception, puis tester manuellement l'expédition et les réponses externes. Ne pas modifier les MX du domaine racine d'une entreprise utilisant déjà Microsoft 365/Gmail sans plan de migration ; privilégier un sous-domaine dédié.
3. Configurer **uniquement côté serveur**, via les secrets Vercel du projet ciblé :
   - `MGMAIL_RESEND_API_KEY` : clé du service d'envoi et de réception, séparée si possible de celle des codes de vérification de connexion.
   - `MGMAIL_RESEND_WEBHOOK_SECRET` : secret Svix/Resend du webhook actif.
   - Endpoint de réception : `https://<domaine-public-magnisa>/api/magnimail/internet/webhook`; événements `email.received`, `email.delivered`, `email.bounced`, `email.failed`, `email.suppressed`. Ces événements mettent à jour l'état des messages ; pas de faux statuts de livraison.
4. Depuis un parcours d'administration **privilégié et vérifié**, attribuer une ligne `mgmail_external_identities` à une **boîte interne préexistante de la même organisation**. L'identité demeure `pending` jusqu'à validation vérifiable du domaine, de l'adresse et de la capacité de réception. N'activer `status='active'` et `receive_enabled=true` que lorsque ces prérequis sont confirmés. Les utilisateurs normaux ne possèdent aucun droit SQL d'activation de telles identités.
5. L'administrateur de l'entreprise définit les droits externes `can_external_read` et `can_external_send` dans la gestion des boîtes collaborateur et dans les délégations. Une permission externe n'accorde rien sans autorisation interne correspondante.
6. Un collaborateur autorisé ouvre MGMail → **E-mails externes**, sélectionne sa boîte publique et envoie son message. L'envoi est journalisé et dédupliqué, et le statut « accepté » ne signifie pas « livré ». Les réponses arrivent uniquement si l'adresse et le webhook entrant sont réellement opérationnels.

## Sécurité, limites et coûts

- La clé Resend et le secret de webhook ne sont jamais exposés au navigateur ni enregistrés dans GitHub.
- Vérification de signature HMAC sur le **corps brut** du webhook et rejet des événements horodatés hors fenêtre de cinq minutes.
- La réception vérifie les destinataires auprès des identités publiques **activées**. Les événements non destinés à une boîte configurée ne sont pas visibles par les entreprises MAGNISA.
- Les e-mails reçus sont conservés **en texte brut (partie text/plain)** pour éviter d'exécuter du HTML distant. Les pièces jointes entrantes et sortantes ne font pas encore partie de ce lot.
- L'envoi repose sur une clé d'idempotence par message et une transition atomique de l'état en base. Un délai réseau peut donner « à vérifier » ; ne pas renvoyer aveuglément.
- Une identité professionnelle réelle exige un domaine autorisé, une infrastructure de réception et un fournisseur configuré. Les TLD internes `.mail` ou `.mgmail` ne sont pas routables sur l'Internet.
- Utiliser les limites du **forfait gratuit réellement disponible** chez le fournisseur avant d'activer une organisation ; ne pas prétendre à une capacité illimitée et ne pas engager de dépenses sans accord.
- Les tests CI de ce lot **n'envoient aucun message réel**, utilisent des utilisateurs éphémères et des identités fictives sur un Supabase local isolé. Les parcours Gmail, Outlook et Proton réels nécessitent une recette de bout en bout sur une boîte et un domaine vérifiés.

## Hors de ce lot

Connexion native Outlook / Microsoft Graph, connexions IMAP/SMTP, réception de pièces jointes, gestion DNS automatique du domaine entreprise, planificateur d'e-mails différés, préavis de facture externes automatiques, quotas/anti-abus avancés, synchronisation des boîtes Gmail dans l'interface Internet unifiée.

Ne pas fusionner cette PR et ne pas la déployer avant **CI, rejeu SQL, tests RLS, et essais avec un domaine autorisé**. La gestion des quotas et le circuit de vérification/activation de domaines doivent être finalisés avant l'ouverture à toutes les entreprises.
