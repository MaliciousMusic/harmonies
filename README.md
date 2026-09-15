# Harmonies — version téléphone, en ligne

Adaptation non officielle du jeu de plateau **Harmonies** (Johan Benvenuto, Libellud, 2024) pour jouer à deux (jusqu'à quatre)
depuis un téléphone, en ligne ou en « passe le téléphone ».

- Règles officielles (livret 2024) : pose des jetons, cartes Animaux, cubes, fin de partie, scores face A (rivière) et face B (îles),
  cartes Esprit de la Nature (variante avancée).
- Les 32 cartes Animaux et les 10 cartes Esprit reprennent les motifs, cubes et points des cartes physiques (données de `src/cards.js`).
- Une seule page HTML autonome (`docs/index.html`), sans framework ; l'état des parties en ligne vit dans Supabase (Postgres + temps réel).

## Structure

| Fichier | Rôle |
| --- | --- |
| `src/cards.js` | Données des cartes (motif = chaîne d'emplacements + directions, valeurs, cube). |
| `src/engine.js` | Moteur de règles pur (plateau hexagonal, pose, motifs, score, tours, fin de partie). Testé sous Node. |
| `src/bot.js` | Joueurs artificiels (3 niveaux : hasard, score immédiat, préparation des habitats). Joués par l'appareil hôte en ligne. |
| `src/animals.js` | Sprite SVG des 42 animaux (généré par `tools/build-animals.py` à partir d'OpenMoji). |
| `src/icons.js` | Icônes d'interface au trait. |
| `src/render.js` | Rendu SVG : jetons, plateaux, miniatures de motifs. |
| `src/net.js` | Transport : Supabase (en ligne, verrou optimiste + temps réel) ou `localStorage` (même appareil). |
| `src/app.js` | Écrans (accueil, salle d'attente, partie), interactions, synchronisation, annulation dans le tour. |
| `src/styles.css` | Styles (mobile d'abord). |
| `index.html` | Coquille de développement (charge `src/*` sans cache). |
| `build.js` | Assemble tout dans `docs/` (page unique + manifeste PWA + icônes), publié par GitHub Pages. |
| `test/engine.test.js` | Tests du moteur (`node --test test/engine.test.js`). |
| `supabase/migrations/*.sql` | Schéma de la table `harmonies_games` (déjà appliqué sur le projet Supabase `harmonies`). |

## Développement

```bash
node --test test/engine.test.js test/bot.test.js   # tests du moteur et des bots
python dev-server.py 8765         # puis http://localhost:8765/index.html (nécessite config.js, voir ci-dessous)
node build.js                     # régénère docs/
```

`config.js` (non versionné) fournit la configuration Supabase en développement :

```js
window.HARMONIES_CONFIG = { url: "https://<ref>.supabase.co", key: "<clé publique anon>" };
```

Astuce test : `?pid=alice&name=Alice` dans l'URL force l'identité du joueur pour l'onglet courant (deux onglets = deux joueurs).

## Côté serveur (Supabase)

Une seule table, `harmonies_games` (`id` = code de la partie, `state` = JSON complet, `version` = verrou optimiste),
accessible avec la clé publique (les parties sont identifiées par un code aléatoire connu des seuls joueurs).
Le joueur actif joue son tour localement (avec « Annuler »), puis l'envoie en une seule écriture ; les autres appareils
reçoivent la mise à jour par le temps réel de Supabase (repli : rechargement toutes les 15 s et au retour sur l'application).
