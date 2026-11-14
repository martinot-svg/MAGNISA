# MGMail — surveillance des domaines d'envoi et de réception

## Comportement

Les demandes de domaines et les identités déjà validées restent gérées par
les processus de la PR #213. Ce lot ajoute une **surveillance de validité**.

Lors de l'exécution quotidienne du cron protégé `/api/cron/notifications` :

1. Pour au maximum **8 domaines** par invocation, par ancienneté de
   `provider_checked_at`, MGMail interroge l'API Resend **GET**.
2. Le domaine doit correspondre à son identifiant fournisseur réel,
   être complètement vérifié et posséder les capacités et enregistrements
   DNS nécessaires. Un MX SPF d'expédition n'est pas considéré comme
   preuve d'un MX de réception.
3. Quand le fournisseur confirme une dégradation, les champs de preuve
   `sending_verified` et `receiving_verified` sont mis à jour. Les
   déclencheurs SQL existants suspendent les identités qui ne peuvent plus
   envoyer ou coupent leur réception si la réception perd sa validation.
4. Une indisponibilité/erreur réseau Resend ne provoque **pas** une
   suspension immédiate sans preuve. En revanche la vérification conserve
   son ancien horodatage et cesse d'autoriser les envois lorsque celui-ci
   dépasse **36 heures**.
5. Une restauration DNS ne réactive pas automatiquement une identité
   précédemment suspendue ; une approbation privilégiée reste nécessaire.
6. Les envois immédiats, programmés et les préavis facturation contrôlent
   la fraîcheur des domaines indépendamment des autorisations attribuées
   aux collaborateurs. Pour les préavis, la réception de la réponse doit
   également rester valide.

## Configuration

Aucun nouvel abonnement, domaine, clé ou ordonnanceur payant n'est requis.
Le contrôle exploite le **cron quotidien existant**, `CRON_SECRET` et la
clé `MGMAIL_RESEND_API_KEY` **uniquement côté serveur**.

Sans `MGMAIL_RESEND_API_KEY` aucun contrôle externe ne démarre ; sans
`MGMAIL_AUTO_SEND_ENABLED=true` aucun e-mail programmé n'est envoyé.
Les échanges Internet réels restent impossibles sans domaine légitime,
DNS et webhook signés, secrets fournisseur et recette préalable.

## Limites de cette livraison

- Monitoring par lot limité : au-delà de 8 domaines, planifier un autre
  ordonnanceur ou adapter la fréquence avant mise en service à grande échelle.
- Le fournisseur Resend peut utiliser plusieurs représentations de ses
  enregistrements : les vérifications échouent volontairement sans preuve
  exploitable ; ne pas remplacer une preuve DNS par un simple nom de domaine.
- Les tests de ce lot simulent les réponses du fournisseur et n'envoient
  aucun message Internet. La vérification finale est un aller-retour contrôlé
  sur un domaine réellement autorisé.
- En production, utiliser des journaux sans secrets, ne jamais mettre la
  clé Resend dans une variable `NEXT_PUBLIC_` et ne pas forcer
  `MGMAIL_AUTO_SEND_ENABLED` tant que la réception et les quotas ne sont
  pas confirmés.
