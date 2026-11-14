# MGMail — programmations et préavis de facturation (PR #208)

## Objectif

Une entreprise MAGNISA doit pouvoir programmer un courrier MGMail sans connexion Google et prévenir automatiquement un client abonné à une prestation récurrente à **J−15, J−10, J−5, J−1** (ou à d'autres délais personnalisés) avant la prochaine date de facturation.

Cette PR ajoute une file d'expédition, une interface et une autorisation par contrat. **Elle n'active aucun envoi par défaut.**

## Conditions pour envoyer réellement

1. Toutes les PR dépendantes (#197, #198, #200, #201, #203, #204) doivent être intégrées dans l'ordre, leurs migrations testées, puis la PR #208 validée.
2. Une véritable adresse publique MGMail doit être activée auprès d'un fournisseur : domaine légitime, SPF, DKIM, DMARC, MX entrants et webhook de réception. Ni `mitalia.digital` ni une adresse interne `.mgmail` ne sont supposés configurés.
3. Les secrets `MGMAIL_RESEND_API_KEY`, `MGMAIL_RESEND_WEBHOOK_SECRET` et `CRON_SECRET` doivent être présents **uniquement côté serveur**. Aucune clé ne doit être incluse dans le dépôt.
4. L'administrateur habilité attribue une boîte Internet au collaborateur et active ses droits d'envoi (et de réception pour les préavis). Les boîtes partagées ont des droits individuels.
5. Pour les préavis récurrents : régler les délais dans **MGMail → Préavis de facturation**, choisir l'adresse expéditrice publique recevant les réponses, vérifier l'adresse du client et confirmer son accord, puis activer le contrat.
6. Activer explicitement `MGMAIL_AUTO_SEND_ENABLED=true` **après** la recette de bout en bout et la validation des quotas/capacités. Tant que ce drapeau n'est pas exactement `true`, ou si la clé du fournisseur manque, le traitement ne fait partir aucun courrier.
7. Le cron `/api/cron/notifications`, protégé par `CRON_SECRET`, exécute le traitement quotidien déjà existant. Il programme les préavis du jour puis prend jusqu'à 15 messages dus par invocation, en lots limités. Il faut dimensionner le traitement avant de proposer l'automatisation à de nombreuses entreprises.

## Sécurité et traitement des erreurs

- Les messages sont d'abord stockés en statut `queued`. Le worker les réserve atomiquement (`sending`) avant l'appel réseau.
- Les envois sont idempotents via leur identifiant unique ; les rappels ne peuvent être créés qu'une fois par `organisation + contrat + date de facture + délai`.
- Un message programmé est réexaminé au moment de l'envoi : collaborateur actif, droit d'envoi Internet toujours accordé, identité publique active.
- Un préavis est réexaminé : contrat actif et échéance inchangée, configuration et confirmation du destinataire toujours actives, identité publique capable de recevoir les réponses, client valide, règle et contenu encore applicables, aucune facture déjà générée pour l'échéance.
- Une facture suspendue, une date reportée, une autorisation retirée ou une échéance dépassée conduit à l'annulation, jamais à un envoi tardif.
- Les réponses fournisseur incertaines deviennent `uncertain` ; elles ne sont **jamais renvoyées aveuglément**. L'état `accepted` signifie acceptation par Resend, pas livraison définitive.
- Les programmations annulées sont distinguées des échecs ; les demandes répétées avec le même identifiant restent dédupliquées.
- Une limite provisoire de 50 courriers programmés en attente par collaborateur réduit les risques d'abus. Le besoin d'un véritable système de quotas anti-spam avant ouverture publique demeure.

## Restrictions du premier lot

- Les heures des programmations sont interprétées en **heure de Madagascar (UTC+03)**, indiquée dans le formulaire ; une entreprise hors Madagascar aura besoin d'un vrai choix de fuseau avant activation.
- Le cron actuel est quotidien ; un message prévu dans la journée peut être expédié après l'heure indiquée lors du passage quotidien suivant. Les messages de plus de 24 heures de retard ne sont pas envoyés. Une file pilotée par un ordonnanceur plus fréquent sera nécessaire pour des heures précises.
- Aucun e-mail de test externe n'est envoyé par la CI. Les tests Supabase utilisent exclusivement une base isolée et des identités fictives.
- Les pièces jointes, les réponses automatiques, les envois groupés massifs, la gestion des rebonds et la garantie de livraison sont à traiter séparément.
- Les préavis ne remplacent pas les vraies factures et n'affirment jamais qu'une facture a déjà été émise.

## Recette avant déploiement

- Build Next.js, tests Vitest, rejeu complet des migrations PostgreSQL et politiques RLS.
- Créer puis annuler une programmation, avec un second collaborateur sans droit : aucune lecture ni modification de messages privés.
- Tester une échéance mensuelle J−15/J−10/J−5/J−1, avec délais libres, interruption de contrat, changement d'adresse client, retrait de la permission et échéance déjà facturée.
- Tester le déclenchement du cron sans et avec les secrets/drapeaux, puis un envoi contrôlé réel et sa réponse entrante depuis Gmail/Outlook/Proton.
- Vérifier le plafond gratuit du fournisseur avant d'activer un domaine ou une organisation ; aucune dépense sans validation.
