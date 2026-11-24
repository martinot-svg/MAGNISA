# Avancement des lots de modernisation MAGNISA

État vérifié sur la branche `feat/magnisa-six-workstreams`. Ce document distingue les fonctions présentes des intégrations qui restent à réaliser.

| Lot | État | Réalisé dans le dépôt | À terminer avant clôture |
|---|---|---|---|
| 1. Catalogue et tarifs | En cours | Catégories organisationnelles, unités contrôlées, création/mise à jour transactionnelle, historique des prix | Rejouer la migration sur une base de test et vérifier les parcours avec données historiques |
| 2. Réservations | En cours | Ressources, fenêtres temporelles, prévention des chevauchements, actions et page de réservation | Valider les tests de concurrence et la migration sur base restaurée |
| 3. CRM approfondi | Partiellement couvert par l'existant | Pipeline prospects, transitions contrôlées, conversion, interventions collaboratives, relances, notifications, prévention de doublons client | Vérifier les contacts multiples, l'historique unifié et les KPI CRM; compléter les tests multi-organisation |
| 4. Automatisation fiable | Contrat applicatif renforcé | Clé d'idempotence, validation tenant/événement, états de reprise, backoff exponentiel plafonné et dead-letter dans le modèle pur | Persistance transactionnelle des jobs, worker/claim concurrent, observabilité et alertes; preuve E2E des actions externes |
| 5. Analytics consolidés | Calculs enrichis, intégration partielle | Tableau de bord financier existant; agrégation du solde restant en retard et comparaison de périodes dans les fonctions pures | Brancher les fonctions aux requêtes serveur, confirmer devise/périodes, réconcilier avec les états comptables et ajouter exports |
| 6. Portail client, signature et paiements | Préparation sécurité uniquement | Vérificateur HMAC générique avec horodatage et tests de signature | Choisir fournisseur de signature et paiement, modèle d'identité client, routes/webhooks propres au fournisseur, idempotence persistée, rapprochement facture/devise, remboursements et révocation |
| 7. Assistant IA | Non démarré | Aucun assistant activé par ce lot | Définir fournisseur/modèle, accès strictement lecture seule aux KPI agrégés, provenance/période affichées, confirmation des actions et tests anti-fuite/prompt injection |

## Garde-fous

- Les commits de cette branche ne sont pas une autorisation de déploiement en production.
- Les migrations doivent être rejouées sur une base isolée avant toute application.
- Les snapshots historiques de devis, commandes, factures et paiements ne doivent pas être recalculés.
- Le vérificateur HMAC générique n'est pas un webhook fournisseur prêt à activer : le format de signature doit être adapté à la documentation du fournisseur retenu.
- Le modèle de reprise d'automatisation n'est pas encore un worker durable : les transitions doivent être persistées atomiquement et protégées contre les exécutions concurrentes.
- Un lot ne doit être déclaré terminé qu'après CI, tests RLS multi-tenant, migration replay, E2E et revue de sécurité.
