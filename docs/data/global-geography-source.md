# Référentiel géographique international

Le formulaire d'inscription utilise le paquet **countrycitystatejson** (`26.11.1001`) pour proposer des subdivisions administratives et des villes lorsque le référentiel dispose de ces données.

- Dépôt source : https://github.com/khkwan0/countryCityStateJson
- Paquet : https://www.npmjs.com/package/countrycitystatejson
- Licence du paquet : MIT
- Périmètre : pays, régions/provinces/États et villes disponibles dans le jeu de données.
- Utilisation : chargement côté serveur uniquement, via l'API interne `/api/geography`.
- Madagascar conserve son référentiel local existant pour préserver les identifiants régionaux et la validation stricte des communes/fokontany.

## Limites de couverture

Le référentiel est communautaire et sa couverture varie selon les pays et les subdivisions. Une liste vide ne signifie pas qu'un pays ne possède aucune région ou ville. Dans ce cas, MAGNISA permet une saisie manuelle plutôt que d'afficher des données inventées. Les suggestions de villes sont filtrées par pays et subdivision sélectionnés.

Les noms proposés sont des suggestions de saisie, pas une preuve officielle de résidence ni un registre administratif exhaustif. Les données de Madagascar restent validées côté serveur avec les références locales connues.

## Mise à jour

Avant toute mise à jour du paquet, vérifier la version, la licence MIT, les changements de couverture et la compatibilité de l'API. Ajouter les corrections utiles au référentiel local lorsqu'elles sont nécessaires à la validation métier.
