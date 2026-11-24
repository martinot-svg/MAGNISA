# Changements de base de données

Les migrations de ce paquet créent uniquement des tables d'extension :
- `magnisa_resource_reservations` pour les réservations temporelles de ressources;
- `magnisa_price_history` pour conserver l'historique des tarifs;
- `magnisa_customer_reminders` pour les rappels CRM.

Chaque table porte `organization_id`. Les politiques RLS imposent une isolation par organisation via une appartenance active à `organization_members`. Vérifier impérativement le nom exact de cette table et de ses colonnes dans le dépôt avant application; adapter la fonction de politique si le schéma réel diffère.

Aucune table `customers`, `services`, `quotes`, `orders`, `invoices`, `subscriptions` ou `notifications` n'est recréée.
