# Architecture

L'application MAGNISA utilise Next.js, TypeScript et Supabase. Ce paquet suit cette architecture et n'introduit ni Laravel, ni Eloquent, ni une seconde couche d'API.

Les services sont des fonctions TypeScript pures ou des adaptateurs recevant un client Supabase. Les accès aux données doivent rester côté serveur et respecter les helpers d'organisation et de permissions déjà présents dans le dépôt.

Les modules CRM, services, devis, commandes, contrats récurrents, facturation et notifications existent déjà en partie dans MAGNISA. Les extensions de ce paquet sont des fondations ciblées et ne doivent pas être substituées aux implémentations existantes sans comparaison.
