# Harmonies — version téléphone, en ligne

Adaptation non officielle du jeu de plateau **Harmonies** (Johan Benvenuto, Libellud, 2024) pour jouer à deux (jusqu'à quatre)
depuis un téléphone, en ligne ou en « passe le téléphone ». L'interface du jeu est en anglais.

- Règles officielles (livret 2024) : pose des jetons, cartes Animaux, cubes, fin de partie, scores face A (rivière) et face B (îles),
  cartes Esprit de la Nature (variante avancée).
- Les 32 cartes Animaux et les 10 cartes Esprit reprennent les motifs, cubes et points des cartes physiques (données de `src/cards.js`).
- Une seule page HTML autonome (`docs/index.html`), sans framework ; l'état des parties en ligne vit dans Supabase (Postgres + temps réel).
- Profil (prénom + animal), chat de partie avec bulle sur l'écran des autres joueurs, bots à 3 niveaux, installable sur l'écran d'accueil (icône lion).
- Sans inscription : chaque appareil a un profil automatique et un **code d'ami**. On ajoute un ami par son code (ou un lien de partage),
  puis on lance une partie avec lui en un geste — il est installé d'office et prévenu, plus besoin de code de partie.
- Accueil façon Ruzzle : parties « à toi de jouer » / en attente des autres / terminées, on passe de l'une à l'autre librement
  (bouton liste dans l'en-tête de la partie, pastille du nombre de parties où c'est à soi de jouer, icône badgée sur l'écran d'accueil).
- Notifications **push** (« Your turn! », nouvelle partie, partie finie, message), même application fermée — sur iPhone une fois
  l'app ajoutée à l'écran d'accueil (iOS 16.4+), sur Android avec Chrome ; plus les alertes de page quand l'onglet est en arrière-plan.

## Structure

| Fichier | Rôle |
| --- | --- |
| `src/cards.js` | Données des cartes (motif = chaîne d'emplacements + directions, valeurs, cube). |
| `src/engine.js` | Moteur de règles pur (plateau hexagonal, pose, motifs, score, tours, fin de partie). Testé sous Node. |
| `src/bot.js` | Joueurs artificiels (3 niveaux : hasard, score immédiat, préparation des habitats). Joués par l'appareil hôte en ligne. |
| `src/animals.js` | Sprite SVG des 42 animaux (généré par `tools/build-animals.py` à partir d'OpenMoji). |
| `src/icons.js` | Icônes d'interface au trait. |
| `src/render.js` | Rendu SVG : jetons, plateaux, miniatures de motifs, collines, lion. |
| `src/net.js` | Transport : Supabase (en ligne, verrou optimiste + temps réel, chat) ou `localStorage` (même appareil). |
| `src/app.js` | Écrans (accueil, salle d'attente, partie), interactions, synchronisation, annulation dans le tour. |
| `src/styles.css` | Styles (mobile d'abord). |
| `index.html` | Coquille de développement (charge `src/*` sans cache). |
| `build.js` | Assemble tout dans `docs/` (page unique + manifeste PWA + icônes + `sw.js`), publié par GitHub Pages. |
| `sw.js` | Service worker de la page publiée (réseau d'abord, cache de secours hors connexion). |
| `tools/icons.html` | Génère les icônes PNG (lion) dans `assets/` via le serveur de développement. |
| `test/engine.test.js` | Tests du moteur (`node --test test/engine.test.js`). |
| `supabase/migrations/*.sql` | Schéma des tables `harmonies_games`, `harmonies_chat`, profils / amis / abonnements push et leurs fonctions, triggers de notification (déjà appliqué sur le projet Supabase `harmonies`). |
| `supabase/functions/harmonies-push/` | Fonction Edge qui envoie les notifications Web Push (VAPID + chiffrement aes128gcm, sans dépendance), appelée par les triggers `pg_net`. |

## Développement

```bash
node --test test/engine.test.js test/bot.test.js   # tests du moteur et des bots
python dev-server.py 8765         # puis http://localhost:8765/index.html (nécessite config.js, voir ci-dessous)
node build.js                     # régénère docs/
```

`config.js` (non versionné) fournit la configuration Supabase en développement :

```js
window.HARMONIES_CONFIG = { url: "https://<ref>.supabase.co", key: "<clé publique anon>", vapid: "<clé publique VAPID>" };
```

La clé publique VAPID s'obtient avec `GET https://<ref>.supabase.co/functions/v1/harmonies-push` (la fonction génère la paire au premier appel
et garde la clé privée dans le coffre Vault du projet).

Astuce test : `?pid=alice&name=Alice&avatar=5` dans l'URL force l'identité du joueur pour l'onglet courant (deux onglets = deux joueurs).
Icônes : ouvrir `http://localhost:8765/tools/icons.html` puis « Generate PNG icons » (le serveur écrit dans `assets/`).

## Côté serveur (Supabase)

Une seule table, `harmonies_games` (`id` = code de la partie, `state` = JSON complet, `version` = verrou optimiste),
accessible avec la clé publique (les parties sont identifiées par un code aléatoire connu des seuls joueurs).
Le joueur actif joue son tour localement (avec « Undo »), puis l'envoie en une seule écriture ; les autres appareils
reçoivent la mise à jour par le temps réel de Supabase (repli : rechargement toutes les 15 s et au retour sur l'application).
Les tours des bots sont joués par l'appareil de l'hôte ; si l'hôte est absent, le premier autre joueur humain connecté prend
le relais après quelques secondes (le verrou optimiste évite les doublons). Le bouton « Skip » termine l'animation en cours et
joue les bots suivants sans animation jusqu'au prochain tour humain.
Le chat utilise la table `harmonies_chat` (une ligne par message, diffusée par le temps réel ; historique rechargé à l'ouverture).

**Profils et amis.** `harmonies_accounts` (pid de l'appareil, secret, code d'ami, prénom, animal), `harmonies_friends` (amitiés
mutuelles) et `harmonies_push` (abonnements Web Push) ne sont accessibles que par des fonctions SQL `SECURITY DEFINER` qui vérifient
le secret de l'appareil (`harmonies_register` le crée dès que le joueur a un prénom). Un trigger maintient `harmonies_games.pids`
(joueurs humains de chaque partie, index GIN) pour lister « mes parties » (`harmonies_home`). Les événements en direct (nouvelle partie,
à toi de jouer, partie finie, message, nouvel ami) sont envoyés par le client sur le canal Broadcast `acct-<pid>` du destinataire ;
l'accueil suit aussi ses parties actives par `postgres_changes` (`id=in.(…)`) et tout le monde est présent sur le canal `harmonies-online`
(pastilles « en ligne »).

**Notifications push.** Les triggers `harmonies_games_notify` / `harmonies_chat_notify` appellent (via `pg_net`, clé partagée dans Vault)
la fonction Edge `harmonies-push`, qui relit la partie, choisit les destinataires (joueur dont c'est le tour, joueurs nouvellement installés,
tous à la fin — jamais celui qui vient de jouer ni ceux listés dans `state.present`, connectés et déjà prévenus dans l'application)
et envoie un Web Push chiffré à chaque appareil abonné, avec le nombre de parties « à toi de jouer » pour la pastille de l'icône.
Le service worker affiche la notification ; un tap ouvre la partie (`?g=<code>`).
