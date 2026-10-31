# Vérifications — 31 octobre 2026

Ces observations décrivent le prototype. Elles ne constituent pas un benchmark sur des vidéos de terrain.

## Vérifications automatisées

`npm run check` : 18 tests ciblés réussis, vérification de syntaxe, build et Worker ESM valides. Les tests API unitaires utilisent des réponses contrôlées et ne consomment aucune clé.

Les tests de résilience vérifient la récupération après des erreurs Google 503 et 500, l’arrêt après trois tentatives, le respect d’un long délai de quota et la gestion des interruptions réseau. Aucun échec n’est remplacé par des annotations inventées.

Les tests couvrent notamment le filtrage du flou et de la similarité, les composantes connexes de sources, l’absence de validation artificielle avec une seule source, les annotations exportables, les en-têtes ZIP/CRC, les identifiants de réponses Gemma et le masquage des erreurs sensibles.

## Parcours navigateur vérifié

Chromium de test : collecte synthétique de 14 images, dont huit filtrées et six retenues pour revue ; ouverture d’une image, choix d’une catégorie, validation humaine, passeport et téléchargement ZIP. Aucun événement d’erreur JavaScript observé sur ce parcours. Affichage vérifié en 1440 px et 390 px, sans défilement horizontal sur mobile.

Un fichier WebM généré pour le test a également été importé, décodé et échantillonné. La webcam physique et tous les codecs MOV/MP4 ne sont pas couverts par ce test.

## Appel réel à Gemma

L’API Google a répondu avec le modèle `gemma-4-26b-a4b-it`. Six illustrations ont reçu des propositions réelles en deux lots. Trois bouteilles illustrées ont été marquées indéterminées, deux illustrations de canettes ont reçu « métal » et une de carton « papier-carton ». L’ambiguïté est donc effectivement conservée, puis soumise à la revue humaine.

Il ne s’agit pas d’une mesure de précision : illustrations synthétiques, échantillon minuscule et aucune évaluation indépendante.

Un lot de quatre images extraites de la vidéo réelle publique « Recycling Video » a aussi été envoyé à Gemma avec succès pendant le diagnostic d’un échec intermittent. Cette observation vérifie le chemin vidéo réelle → images → API ; elle n’établit pas une disponibilité permanente du fournisseur.

## Export vérifié indépendamment

Le ZIP téléchargé a été ouvert avec `zipfile` de Python : intégrité CRC correcte, nombre de lignes d’annotations cohérent avec les images validées, empreintes SHA-256 des images conformes. Les empreintes des consignes exportées correspondent aux consignes exactes envoyées au modèle. Le modèle et les décisions humaines sont présents dans la provenance.

Les vidéos originales, `.env`, les clés et les fichiers locaux de test sont exclus de la publication du code. L’archive de déploiement contient seulement le Worker construit et son manifeste.
