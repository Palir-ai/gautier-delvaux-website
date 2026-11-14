# Gautier Delvaux — Nouveau site web

Refonte complète de www.gautierdelvaux.be — identité conservée (logo, couleurs or champagne `#B99253` / crème / brun espresso `#2e2414`, photos du cabinet et portrait), design repensé dans un esprit maison de luxe.

## Voir le site

Double-cliquez simplement sur `index.html` — le site s'ouvre dans votre navigateur.
(Connexion internet requise pour les polices, la carte Google Maps et le widget d'avis Doctoranytime.)

## Pages

| Fichier | Contenu |
|---|---|
| `index.html` | Accueil — hero, approches, à propos, méthode, infos pratiques, carte |
| `psychotherapie-generale.html` | Psychothérapie générale |
| `psychotherapie-emdr.html` | Psychothérapie EMDR |
| `hypnotherapie.html` | Hypnothérapie — PTR |
| `consultations-en-ligne.html` | Consultations en ligne |
| `formations.html` | Formations, certifications, visa SPF |
| `articles.html` | Liste des articles |
| `article-*.html` | Les 10 articles du blog, intégralement migrés |
| `faq.html` | Questions fréquentes (accordéons) |

`assets/css/style.css` — tout le design. `assets/js/main.js` — menu mobile, animations, accordéons. `assets/img/` — logo, photos, favicon.

## Version audio des articles

Chaque article peut être écouté (bouton « Écouter » sur la liste des articles et sur la page de l'article). L'audio est créé automatiquement et gratuitement, sans service payant ni compte :

1. Un article `article-*.html` est ajouté ou modifié, puis envoyé sur GitHub (branche `main`).
2. L'automatisation `.github/workflows/article-audio.yml` lance `scripts/generate-audio.mjs`, qui extrait le titre et le texte (sans la bibliographie) et génère un MP3 avec Piper, un moteur de voix libre (voix française « Tom »).
3. Le MP3 est enregistré dans `assets/audio/` et listé dans `assets/audio/manifest.json` ; le bouton apparaît alors tout seul, une à deux minutes après l'envoi.

Pour générer en local : `bash scripts/setup-voice.sh` (une fois, nécessite Python, Node et ffmpeg), puis `node scripts/generate-audio.mjs`.

Pour qu'un passage ne soit pas lu, ajouter l'attribut `data-audio-skip` à son élément HTML. Une nouvelle carte dans `articles.html` doit reprendre la structure des cartes existantes (`article-link` + `card-actions`).

## Espace d'administration (`/admin`)

Gautier se connecte sur `/admin` (e-mail + mot de passe) pour publier, modifier ou retirer des articles, consulter les statistiques de fréquentation et afficher un bandeau d'annonce. L'espace fonctionne uniquement sur Cloudflare Pages (pas sur GitHub Pages).

| Élément | Emplacement |
|---|---|
| Écrans (connexion, éditeur, statistiques, réglages) | `admin/` |
| Serveur : connexion, articles, réglages, statistiques | `functions/admin/api/[[path]].js`, `server/lib.js` |
| Compteur de visites (sans cookie, totaux par jour uniquement) | `functions/api/hit.js` |
| Réglages publiés (bandeau, écoute des articles) | `assets/data/site.json` |

Publier un article depuis l'admin crée `article-<titre>.html`, met à jour `articles.html` et `sitemap.xml` dans le dépôt GitHub ; le site se remet en ligne tout seul environ une minute plus tard, et l'audio est généré par l'automatisation existante.

Réglages à créer dans Cloudflare Pages (Settings → Variables and Secrets, et Bindings) :

| Nom | Rôle |
|---|---|
| `DB` (liaison D1) | Base de données : mot de passe chiffré, brouillons, statistiques |
| `ADMIN_EMAIL` | Adresse e-mail de connexion |
| `SESSION_SECRET` (secret) | Longue valeur aléatoire, signe les sessions |
| `SETUP_TOKEN` (secret) | Jeton du lien de création du mot de passe : `/admin/#setup=<jeton>`, utilisable une seule fois. Pour réinitialiser un mot de passe oublié, changer ce jeton et transmettre le nouveau lien. |
| `GITHUB_TOKEN` (secret) | Jeton GitHub limité à ce dépôt (Contents : lecture et écriture) |
| `GITHUB_REPO` | `Palir-ai/gautier-delvaux-website` |

Test en local : créer `.dev.vars` avec ces valeurs, puis `npx wrangler@4.86.0 pages dev . --d1 DB=gautier-delvaux-admin`.

## Référencement (SEO)

- `_redirects` : redirections permanentes de toutes les anciennes adresses Odoo vers les nouvelles pages.
- `sitemap.xml`, `robots.txt` : à déclarer dans Google Search Console après la mise en ligne.
- `_headers` : les adresses de prévisualisation `*.pages.dev` et `/admin` ne sont pas indexées.
- Les adresses officielles sont sans `.html` (`/faq`, `/formations`…) ; Cloudflare Pages les sert ainsi automatiquement.

## Mise en ligne

Le site est 100 % statique : il se dépose tel quel chez n'importe quel hébergeur (OVH, Infomaniak, Netlify, Vercel, GitHub Pages…). Aucune base de données ni serveur nécessaire.

Pour conserver le référencement lors de la migration, prévoir ces redirections (301) :

| Ancienne URL | Nouvelle page |
|---|---|
| `/psychotherapies` | `psychotherapie-emdr.html` |
| `/consultations-virtuelles` | `consultations-en-ligne.html` |
| `/blog/2` | `articles.html` |
| `/formations` | `formations.html` |
| `/faq` | `faq.html` |
| `/psychotherapie-generale` | `psychotherapie-generale.html` |
| `/visa-federal-psychologue-clinicien` | `formations.html` |
| `/blog/actualites-2/<slug>` | `article-*.html` correspondant |

Les 10 articles du blog sont intégralement migrés dans le site (fichiers `article-*.html`).
