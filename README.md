# Portfolio — Aimé Kouassi Ruben EBAH

Portfolio personnel de **Ruben EBAH**, développeur web & mobile, designer et motion designer.
Site public + espace administrateur sécurisé, servi par un serveur Node.js **sans aucune dépendance externe**.

---

## Démarrage rapide

### Windows

Double-cliquez sur **`demarrer.bat`**.

### En ligne de commande

```bash
node server.js
```

Puis ouvrez :

- Site public : <http://127.0.0.1:4173/>
- Administration : <http://127.0.0.1:4173/admin>

### Identifiants initiaux

| Champ | Valeur |
| --- | --- |
| Utilisateur | `ruben` |
| Mot de passe | `RubenEbah!2026` |

> **Changez ce mot de passe dès la première connexion** (onglet *Sécurité* du tableau de bord).
> Les identifiants initiaux peuvent aussi être définis avant le premier lancement :

```bash
set ADMIN_USER=monutilisateur
set ADMIN_PASSWORD=MonMotDePasse!2026
node server.js
```

---

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `4173` | Port d'écoute |
| `HOST` | `127.0.0.1` | Interface réseau (`0.0.0.0` pour exposer sur le réseau local) |
| `ADMIN_USER` | `ruben` | Identifiant créé au premier démarrage |
| `ADMIN_PASSWORD` | `RubenEbah!2026` | Mot de passe créé au premier démarrage |
| `SITE_URL` | *(auto)* | URL publique utilisée dans `robots.txt` et `sitemap.xml` |
| `TRUST_PROXY` | `0` | Mettre `1` derrière un reverse proxy pour lire `X-Forwarded-For` |
| `SECURE_COOKIES` | `0` | Mettre `1` en HTTPS (cookies `Secure` + HSTS) |

Exemple pour un déploiement HTTPS derrière Nginx :

```bash
set SITE_URL=https://ruben-ebah.com
set TRUST_PROXY=1
set SECURE_COOKIES=1
set HOST=127.0.0.1
node server.js
```

---

## Fonctionnalités

### Site public

- Photo du héros manipulable **à 360°** (souris, tactile, clavier, double-clic), même photo sur les deux faces.
- Projets rendus **côté serveur** : grille filtrable sur l'accueil, page dédiée par projet.
- Certificats Cursa consultables en grand format (lightbox).
- Parcours, compétences, services design & motion design.
- Formulaire de contact avec validation et anti-spam.
- Suivi de visites anonyme (cookie visiteur, durée, profondeur de scroll, appareil, référent).
- Réseaux sociaux réels : GitHub, LinkedIn, TikTok, WhatsApp, email.
- CV téléchargeable, `robots.txt`, `sitemap.xml`, page 404.

### Espace administrateur

- Connexion protégée (scrypt, 5 tentatives max, verrouillage 15 min).
- Tableau de bord : pages vues, visiteurs uniques, visites du jour, durée moyenne, graphique 14 jours, répartition des appareils, pages et projets les plus consultés, sources de trafic.
- Journal d'activité filtrable et paginé.
- Gestion complète des projets : création, modification, suppression, mise à la une, upload d'image (JPEG/PNG/WebP, 3 Mo max, vérification du contenu binaire).
- Boîte de réception des messages, réponse par email, suppression.
- Export CSV des visites.
- Changement de mot de passe, révocation des autres sessions.

---

## Sécurité

| Mesure | Détail |
| --- | --- |
| Hachage | `scrypt` (N=16384, r=8, p=1), sel aléatoire de 128 bits |
| Sessions | Jeton de 256 bits en mémoire, cookie `HttpOnly` + `SameSite=Strict` |
| CSRF | Jeton par session, en-tête `X-CSRF-Token` sur toute écriture |
| Origine | Vérification `Origin` sur la connexion et les actions sensibles |
| Force brute | 5 échecs → verrouillage 15 minutes par IP |
| Anti-DoS | Limitation globale par IP (600 req/5 min) + timeouts HTTP (slowloris) |
| En-tête Host | Validation stricte de l'en-tête Host (anti-injection) |
| Traversée | Vérification realpath + rejet des octets nuls et de `..` |
| Sessions | Révocation des autres sessions au changement de mot de passe et à la connexion |
| En-têtes | CSP à nonce, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP |
| Uploads | Type MIME déclaré + **signature binaire** vérifiée, nom aléatoire, taille limitée |
| Traversée | Résolution de chemin confinée à `public/` |
| Injection | Tout contenu rendu est échappé ; aucune concaténation SQL (stockage JSON) |
| Journal | Connexions, échecs, modifications et suppressions horodatés avec IP masquée |
| Données | Écritures atomiques (fichier temporaire + `rename`) |

> Les données sont stockées dans `data/*.json`. Sauvegardez ce dossier régulièrement.
> Les sessions sont en mémoire : un redémarrage du serveur déconnecte l'administrateur.

---

## Structure

```
mon-portfolio/
├── server.js                 Serveur HTTP, API, rendu SSR, sécurité
├── demarrer.bat              Lancement Windows
├── data/
│   ├── projects.json         Projets
│   ├── admin.json            Identifiants (hachés)
│   ├── visits.json           Visites
│   ├── actions.json          Journal d'audit
│   └── messages.json         Messages de contact
├── views/
│   ├── project.html          Gabarit page projet
│   ├── admin-login.html      Page de connexion
│   ├── admin-dashboard.html  Tableau de bord
│   └── 404.html              Page introuvable
└── public/
    ├── index.html            Accueil
    ├── favicon.svg
    ├── uploads/              Images ajoutées via l'admin
    └── assets/
        ├── css/              style.css, admin.css, fonts.css
        ├── js/               main.js, admin.js, login.js, icons.js
        ├── fonts/            Polices locales
        ├── img/              Photos et visuels de projets
        └── CV-Ruben-EBAH.pdf
```

---

## API

### Publique

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/projects` | Liste publique des projets |
| `POST` | `/api/track` | Événement de visite (`page_view`, `heartbeat`, `page_exit`) |
| `POST` | `/api/contact` | Envoi d'un message |

### Administration (session requise)

| Méthode | Route | Description |
| --- | --- | --- |
| `POST` | `/api/admin/login` | Connexion |
| `POST` | `/api/admin/logout` | Déconnexion |
| `GET` | `/api/admin/session` | Informations de session |
| `GET` | `/api/admin/stats` | Statistiques agrégées |
| `GET` | `/api/admin/visits` | Visites paginées (`q`, `page`, `limit`) |
| `GET` | `/api/admin/visits/export` | Export CSV |
| `GET` | `/api/admin/actions` | Journal d'activité (`type`, `page`, `limit`) |
| `GET` | `/api/admin/projects` | Projets (admin) |
| `POST` | `/api/admin/projects` | Créer un projet |
| `PUT` | `/api/admin/projects/:id` | Modifier un projet |
| `DELETE` | `/api/admin/projects/:id` | Supprimer un projet |
| `GET` | `/api/admin/messages` | Messages |
| `PATCH` | `/api/admin/messages/:id` | Marquer comme lu |
| `DELETE` | `/api/admin/messages/:id` | Supprimer |
| `POST` | `/api/admin/password` | Changer le mot de passe |
| `POST` | `/api/admin/logout-all` | Révoquer les autres sessions |

---

## Mise en production

1. Définir `SITE_URL`, `SECURE_COOKIES=1`, `TRUST_PROXY=1`.
2. Placer le serveur derrière un reverse proxy HTTPS (Nginx, Caddy).
3. Sauvegarder `data/` et `public/uploads/`.
4. Changer le mot de passe initial.

Exemple Nginx :

```nginx
server {
    listen 443 ssl http2;
    server_name ruben-ebah.com;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

© 2026 Aimé Kouassi Ruben EBAH — Tous droits réservés.
