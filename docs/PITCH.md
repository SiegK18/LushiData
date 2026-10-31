# Pitch — environ 90 secondes

« Avant d’entraîner une IA de vision, il faut préparer les données. Une vidéo donne beaucoup d’images, mais aussi du flou, des doublons et des annotations à vérifier.

LushiData organise ce travail. Je charge une vidéo ou capture mon environnement. Les images sont extraites dans le navigateur et filtrées ; les exclusions restent inspectables.

Le cœur est Gemma 4, utilisé en ligne. En détection, il propose un rectangle et une catégorie pour chaque objet visible ; plusieurs objets peuvent apparaître dans une même image. Je peux déplacer les rectangles, corriger les catégories et ajouter les objets manquants. Je garde la décision : je vérifie et je valide chaque scène.

L’export contient aussi un passeport : sources, contrôles, corrections, consignes et limites. Les images d’une même vidéo restent dans une partition pour réduire les fuites entre entraînement et évaluation.

Le cas présenté est le tri des déchets. C’est un prototype à tester avec des utilisateurs locaux ; les illustrations synthétiques sont signalées. Nous ne promettons pas un dataset parfait : nous rendons sa préparation vérifiable.

Le code est public et documenté pour permettre les contributions. »

## Démonstration

Charger un exemple → montrer un doublon filtré → appeler Gemma → corriger et valider une image → consulter le passeport → télécharger le ZIP.

## Réponses au jury

- **Pourquoi Gemma ?** Il effectue la pré-annotation visuelle ; le modèle appelé est tracé dans les résultats.
- **Parfait ?** Non. Les annotations sont revues et les limites accompagnent le dataset.
- **Impact ?** Réduire la préparation est l’objectif ; gain et adoption restent à mesurer localement.
- **Entraînement ?** Détection multi-objets avec exports YOLO et COCO, ou classification d’images avec export ImageFolder, selon le mode choisi avant la collecte.
- **Benchmark local ?** Non. L’exemple est synthétique ; une collecte de terrain autorisée est à construire.
