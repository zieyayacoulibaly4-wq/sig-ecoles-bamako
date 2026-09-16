# 🗺️ SIG Écoles de Bamako

**Système d’Information Géographique pour le géoréférencement, la visualisation et l’analyse des établissements scolaires de Bamako (Mali).**

Le projet **SIG Écoles de Bamako** est une plateforme géospatiale permettant de centraliser, synchroniser, visualiser et analyser les données des établissements scolaires de Bamako.

La plateforme combine la collecte des données avec **KoboToolbox**, leur traitement avec **Python et PostgreSQL**, leur stockage en ligne avec **Supabase**, puis leur visualisation dans une interface web interactive.

---

## 🎯 Objectif du projet

L'objectif principal est de mettre en place une **base de données géospatiale des établissements scolaires de Bamako** afin de faciliter :

* la localisation des établissements scolaires ;
* l'analyse de leur répartition géographique ;
* le suivi de leur fonctionnement ;
* l'analyse des effectifs et des salles de classe ;
* la comparaison entre les communes et les quartiers ;
* la consultation rapide des informations d'une école ;
* la production d'indicateurs utiles à la planification scolaire.

Le système est conçu pour pouvoir évoluer avec l'ajout de nouvelles données provenant des collectes de terrain.

---

## 🏗️ Architecture du projet

Le projet utilise une architecture basée sur plusieurs étapes :

```text
┌───────────────────┐
│   KoboToolbox     │
│ Collecte terrain  │
└─────────┬─────────┘
          │
          │ Export des données
          ▼
┌───────────────────┐
│       CSV         │
│ Données exportées │
└─────────┬─────────┘
          │
          │ Traitement Python
          ▼
┌───────────────────┐
│    PostgreSQL     │
│ Base locale       │
└─────────┬─────────┘
          │
          │ Synchronisation
          ▼
┌───────────────────┐
│     Supabase      │
│ Base en ligne     │
└─────────┬─────────┘
          │
          │ API
          ▼
┌───────────────────┐
│     Frontend      │
│ HTML/CSS/JS       │
│ Leaflet + Charts  │
└───────────────────┘
```

### Rôle de chaque composant

| Composant       | Rôle                                        |
| --------------- | ------------------------------------------- |
| **KoboToolbox** | Collecte des informations sur le terrain    |
| **CSV**         | Format intermédiaire d'échange des données  |
| **Python**      | Export, transformation et synchronisation   |
| **PostgreSQL**  | Stockage et traitement local des données    |
| **Supabase**    | Stockage en ligne et accès aux données      |
| **Frontend**    | Visualisation et analyse des établissements |
| **Leaflet**     | Carte interactive                           |
| **Chart.js**    | Graphiques statistiques                     |

---

# 📁 Structure du projet

```text
PROJET-G/
│
├── backend/
│   ├── config.py
│   ├── main.py
│   ├── requirements.txt
│   │
│   ├── database/
│   │   ├── postgres.py
│   │   ├── sync_postgres.py
│   │   └── sync_supabase.py
│   │
│   └── kobo/
│       └── kobo_export.py
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── .gitignore
└── README.md
```

---

# 🔄 Flux de données

## 1. Collecte avec KoboToolbox

Les agents peuvent collecter les informations des établissements scolaires à partir du formulaire KoboToolbox.

Les données collectées comprennent notamment :

* identifiant de l'école ;
* nom de l'établissement ;
* type ;
* niveau ;
* commune ;
* quartier ;
* position GPS ;
* effectif ;
* nombre de salles ;
* statut de fonctionnement ;
* année de création ;
* source de la donnée.

---

## 2. Export Kobo → CSV

Le script :

```text
backend/kobo/kobo_export.py
```

récupère les données depuis KoboToolbox
