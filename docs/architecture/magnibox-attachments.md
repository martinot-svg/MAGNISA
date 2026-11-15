# MAGNIBOX — pièces jointes entrantes

## Contrat de sécurité

- Bucket Supabase privé `magnibox-attachments`, sans politique Storage côté navigateur.
- Quarantaine par défaut : `quarantined` → `scanning` → `available` ou `rejected`.
- Seuls les fichiers marqués `available` sont visibles dans les métadonnées RLS.
- Maximum par message : 5 fichiers, 10 Mio par fichier, 20 Mio au total.
- Le chemin de stockage est lié à l'organisation et au message ; le nom d'origine n'est jamais utilisé comme chemin.
- SHA-256 conservé pour contrôler l'intégrité.
- Le type MIME déclaré par l'expéditeur ne constitue jamais une preuve : le serveur devra détecter le type réel et le scanner avant de passer à `available`.

## Limite actuelle

Cette migration prépare le stockage et le modèle d'autorisation, mais n'active pas encore la réception des pièces jointes. Le bridge Postfix les refuse toujours explicitement. Aucun téléchargement ni affichage ne doit être exposé avant l'intégration d'un scanner antivirus fiable et du worker qui valide les fichiers. Cela évite de livrer aux utilisateurs des pièces jointes non contrôlées.
