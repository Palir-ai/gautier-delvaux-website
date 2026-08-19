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
