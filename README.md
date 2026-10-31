# LushiData ✳

**De la vidéo aux données utiles.** Un prototype pour Hack Day 2026 à Lubumbashi : transformer une vidéo ou un flux webcam en dataset de **classification d’images**, pré-annoté par **Gemma 4 hébergé**, puis vérifié humainement.

> Gemma propose. Vous vérifiez. Chaque dataset conserve ses preuves et ses limites.

## Le problème

Préparer les données précède tout entraînement de vision. Extraire toutes les images d’une vidéo crée des doublons ; répartir des images voisines entre entraînement et validation donne une évaluation trompeuse. LushiData organise la collecte, le contrôle, l’annotation et la revue. Le cas de démonstration est le tri des déchets ; l’impact auprès d’utilisateurs locaux reste à valider.

## Fonctionnalités

- Vidéos lisibles par le navigateur : MP4/WebM/MOV selon les codecs, 50 Mo par fichier, six sources et 48 images maximum.
- Capture webcam pendant dix secondes, sans microphone.
- Extraction JPEG locale ; netteté par variance du Laplacien et filtre d’exposition.
- Images similaires détectées par dHash 64 bits, distance de Hamming ≤ 4. Exclusions réversibles et documentées.
- Annotation réelle par **`gemma-4-26b-a4b-it`** via l’API Google. Aucun téléchargement des poids ni remplacement silencieux de modèle.
- Catégories configurables, réponse JSON vérifiée côté serveur et ambiguïtés signalées.
- Correction et validation **image par image** ; aucune validation automatique.
- ZIP avec arborescence ImageFolder, CSV/JSONL, sources, prompts exacts et SHA-256.
- Séparation par vidéo source ; les sources reliées par des images proches restent dans la même partition.
- Passeport : classes, sources, décisions, temps API, acceptation des propositions et limites.

## Démarrage

Node.js **22.15+ ou 24 LTS**. Aucun paquet tiers nécessaire.

```sh
git clone https://github.com/SiegK18/LushiData.git
cd LushiData
```

Copier `.env.example` vers `.env` et renseigner :

```dotenv
GEMINI_API_KEY=votre_cle_google_ai_studio
GEMMA_MODEL=gemma-4-26b-a4b-it
PORT=4317
```

```sh
npm run dev
```

Ouvrir **http://127.0.0.1:4317**. `.env` est ignoré par Git. La clé reste côté serveur ; il contacte Google avec l’en-tête `x-goog-api-key`.

## Démo en deux minutes

1. **Essayer un exemple** : trois sources d’illustrations synthétiques, des variantes, un doublon intentionnel et une image uniforme. Ce ne sont pas des images de terrain et aucune annotation Gemma n’est préfabriquée.
2. Autoriser explicitement l’envoi des images et cliquer **Annoter avec Gemma**.
3. Inspecter, corriger au besoin et valider les images. Un cas indéterminé exige une catégorie finale.
4. Lire le passeport et télécharger le ZIP.
5. Pour une collecte réelle, recommencer avec plusieurs vidéos autorisées de scènes distinctes.

Sans accès à Google, collecte, filtres, annotation manuelle et export restent utilisables. L’application affiche l’échec réel de l’API et ne simule pas Gemma.

## Export

```text
dataset.zip
├── train/<classe>/*.jpg
├── val/<classe>/*.jpg             # si sources indépendantes suffisantes
├── test/<classe>/*.jpg
├── annotations.jsonl             # proposition, qualité, décision humaine
├── annotations.csv
├── classes.json                  # identifiants explicites et dossiers
├── sources.json
├── quality_report.json
├── dataset_card.md
├── rejected_manifest.json        # métadonnées, pas les pixels exclus
├── annotation_prompt.txt         # consigne modèle
├── annotation_prompts.json       # consignes réellement envoyées + SHA-256
└── checksums.sha256
```

Les empreintes d’images portent sur les octets JPEG exacts. L’empreinte webcam porte sur la concaténation des empreintes des captures ; celle d’une illustration identifie sa recette. `checksum_kind` explicite ces distinctions.

Seules les images validées avec une catégorie autorisée sont exportées. Vérifier les indices de `classes.json` car certains chargeurs ImageFolder trient les dossiers alphabétiquement. Il s’agit de classification, pas de détection d’objets : aucune boîte englobante.

## Séparation des données

Un graphe relie les sources dont les images validées ont le même SHA-256 ou un dHash distant d’au plus quatre bits. Une composante connexe reste dans une seule partition. Un groupe donne uniquement `train` ; deux donnent `train` et `val` ; à partir de trois, des groupes sont réservés à `val` et `test`.

Cette méthode réduit une fuite évidente entre images voisines. Elle ne garantit ni indépendance sémantique parfaite, ni ratio 70/15/15, ni équilibre. Le rapport signale les classes absentes et partitions insuffisantes.

## Mesures et limites

- Images retenues, filtres, corrections, validations, requêtes et temps API sont réels. L’acceptation humaine d’une proposition **n’est pas une précision scientifique**.
- Pour mesurer le gain de temps, comparer le même échantillon annoté manuellement et avec assistance. Aucun gain n’est prérempli.
- Les vidéos et décisions restent en mémoire dans l’onglet. **Exporter avant fermeture ou rechargement.** Pas de sauvegarde durable.
- Seuls les JPEG sélectionnés sont transmis à Google après action explicite. Aucun stockage applicatif serveur ; les politiques de Google restent applicables.
- Utiliser des images autorisées. La licence du code n’accorde aucun droit sur les vidéos.
- L’exemple synthétique montre le parcours, pas la qualité d’un modèle sur des déchets réels.
- Les filtres et annotations peuvent être erronés. Aucun dataset parfait, performance d’entraînement ou représentativité locale n’est promis.
- Le proxy doit rester privé ou authentifié avant exposition sur Internet. Le serveur local écoute `127.0.0.1`. Sites protège l’instance hébergée par son contrôle d’accès.

## Architecture et vérification

```text
Navigateur : vidéo/webcam → Canvas → filtres → JPEG sélectionnés
    → serveur /api/annotate → Google Gemma 4
    ← JSON vérifié et provenance ←
    → revue humaine → séparation par source → ZIP + passeport
```

`src/core.js` : qualité, partitions, rapport et ZIP. `src/server.js` : validation, proxy et erreurs masquées. `src/app.js` : interface. `scripts/build.mjs` : interface et Worker ESM autonomes. `scripts/dev.mjs` : même Worker en local.

```sh
npm run check
```

Syntaxe, tests ciblés, build et artefact. Les tests API utilisent des réponses contrôlées et ne remplacent pas un appel réel.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md), [ROADMAP.md](ROADMAP.md) et le [pitch](docs/PITCH.md). Les neuf critères officiels de la grille locale n’ont pas été communiqués ; aucune conformité exhaustive ou note de jury n’est affirmée.

Code : [MIT](LICENSE). Illustrations procédurales : CC0-1.0. Données importées : droits propres.

[Documentation Google Gemma hébergé](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) · [Images via la Gemini API](https://ai.google.dev/gemini-api/docs/image-understanding)

**Hack Day 2026 · Lubumbashi**
