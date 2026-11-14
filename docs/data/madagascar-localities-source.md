# Madagascar — sources du catalogue de suggestions

Le fichier `src/data/madagascar-localities.json` est dérivé de
[raherygino/madagascar-data](https://github.com/raherygino/madagascar-data),
fichier `data.csv` (historique 2018). Licence MIT, copyright (c) 2020 @Julkwel.
Licence d'origine :
https://github.com/raherygino/madagascar-data/blob/master/LICENSE

Le corpus comprend **16 827 combinaisons distinctes** (fokontany, commune,
district, région), après suppression des doublons et des lignes dépourvues
d'affiliation administrative complète.

Les adaptations territoriales à 24 régions découlent de :
- Loi n°2023-012, création d'Ambatosoa (Maroantsetra, Mananara Nord).
- Scission de Vatovavy-Fitovinany en Vatovavy (Mananjary, Nosy Varika,
  Ifanadiana) et Fitovinany (Manakara, Vohipeno, Ikongo).

Sources officielles :
https://assemblee-nationale.mg/wp-content/uploads/2024/02/LOI-n%C2%B02023-012-24eme-r%C3%A9gion.pdf
https://www.instat.mg/documents/upload/main/INSTAT_RGPH-3_ATLAS%20DEMOGRAPHIQUE.pdf

Limites : données historiques potentiellement incomplètes ; orthographes
administratives et rattachements à vérifier. Les villages absents doivent
toujours pouvoir être saisis librement ; aucune suggestion n'est une
certification de résidence. Les codes 901 à 924 sont des **identifiants
internes MAGNISA de région**, non des codes géographiques officiels ni des
codes de ville. Les données personnelles de résidence demeurent dans le
schéma `private` et ne doivent pas être exposées via les profils.
