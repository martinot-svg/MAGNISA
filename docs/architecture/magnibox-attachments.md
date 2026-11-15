# MAGNIBOX — pièces jointes entrantes

## Contrat de sécurité

- Bucket Supabase privé `magnibox-attachments`, sans politique Storage côté navigateur.
- Quarantaine par défaut : `quarantined` → `scanning` → `available` ou `rejected`.
- Seuls les fichiers marqués `available` sont visibles dans les métadonnées RLS.
- Maximum par message : 5 fichiers, 30 Mio par fichier, 150 Mio au total.
- Le chemin de stockage est lié à l'organisation et au message ; le nom d'origine n'est jamais utilisé comme chemin.
- SHA-256 conservé pour contrôler l'intégrité.
- Le type MIME déclaré par l'expéditeur est une indication non fiable. Le worker détermine le type réel par signature et passe chaque fichier dans ClamAV avant toute disponibilité.
- Le téléchargement exige une ligne de métadonnées visible par RLS pour l'utilisateur connecté ; le serveur signe ensuite uniquement le chemin de stockage correspondant pour 60 secondes.

## Parcours d'ingestion

1. Postfix transmet le message MIME complet au bridge après les contrôles de filtrage.
2. Le bridge extrait le corps texte et jusqu'à cinq pièces jointes, avec une limite de 30 Mio par fichier et 150 Mio cumulés. Les octets sont encodés en base64 dans le webhook HMAC-SHA256.
3. L'API valide la signature, la fraîcheur, les destinataires, le format base64 et les limites.
4. L'API écrit chaque objet dans le bucket privé avec un chemin UUID lié à l'organisation et au message, puis crée les métadonnées en état `quarantined`.
5. Le worker vérifie taille, SHA-256, type réel et verdict ClamAV. Seuls les fichiers propres deviennent `available`.
6. L'API de téléchargement vérifie l'accès RLS, puis émet une URL signée courte durée.

## Limites et activation

Les pièces jointes ZIP/Office, les formats inconnus, les fichiers infectés, les fichiers vides et les contenus hors limites ne deviennent jamais disponibles. Les plafonds MTA et ClamAV sont réglés à 220 Mio afin de couvrir l'encodage MIME/base64 du cumul autorisé. Les échecs d'infrastructure restent en quarantaine et sont retentés dans la limite configurée. Les migrations élargissent les types MIME acceptés uniquement à l'intérieur du bucket privé, car le MIME SMTP est falsifiable ; l'accès utilisateur reste bloqué jusqu'au verdict du scanner.

Le bridge ne doit être activé sur le transport Postfix de production qu'après validation du MTA pilote, de la chaîne ClamAV Postfix, des workflows CI et du replay des migrations. Aucun MX public ni secret de production n'est modifié par ces changements.
