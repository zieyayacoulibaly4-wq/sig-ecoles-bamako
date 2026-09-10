# SIG Écoles de Bamako

Portail géospatial pour visualiser, filtrer et analyser les établissements scolaires de Bamako (Mali) : carte interactive, tableau, statistiques, et import de données au format CSV.

## Fonctionnalités

- **Carte interactive (Leaflet)** : localisation des écoles avec marqueurs colorés par type d'établissement, popup détaillé, changement de fond de carte (OSM / satellite), géolocalisation de l'utilisateur, plein écran.
- **Tableau des établissements** : liste complète, triable, avec accès à la fiche détail de chaque école.
- **Statistiques** : nombre d'écoles, effectifs, taux de fonctionnalité, répartition par commune / type / niveau, classement des communes, analyse automatique.
- **Filtres** : recherche libre, commune, quartier, type d'établissement, niveau, statut de fonctionnement.
- **Import CSV** : chargement des données depuis un fichier CSV (aucune base de données requise), avec export du jeu de données filtré.
- **Mode admin** : accès protégé par mot de passe pour importer un nouveau fichier de données.
- **Itinéraire indicatif** : tracé simple entre la position de l'utilisateur et une école sélectionnée.

## Structure du projet

```
├── index.html      # Structure de la page (accueil, carte, tableau, statistiques)
├── app.js          # Logique de l'application (import CSV, filtres, carte, graphiques)
├── style.css       # Mise en forme et responsive (desktop / mobile)
```

## Format du fichier CSV attendu

Le fichier importé doit contenir les colonnes suivantes (séparateur `;`) :

| Colonne                                | Description                          |
|-----------------------------------------|---------------------------------------|
| `id_ecole`                              | Identifiant unique de l'école        |
| `Nom officiel de l'établissement`       | Nom de l'école                        |
| `Type d'établissement`                  | Public / Privé / Communautaire        |
| `Niveau`                                | Fondamental / Secondaire / Technique  |
| `Commune`                               | Commune de Bamako                     |
| `Quartier`                              | Quartier                              |
| `Adresse / repère`                      | Adresse ou point de repère            |
| `Position GPS de l'école`               | Coordonnées GPS ("lat lon ...")       |
| `Effectif total (élèves)`               | Nombre total d'élèves                 |
| `Nombre de salles de classe`            | Nombre de classes                     |
| `Statut de fonctionnement`              | Fonctionnel / Non fonctionnel         |
| `Année de création`                     | Année de création de l'école          |
| `Source de la donnée`                   | Source de la collecte                 |

## Utilisation

1. Ouvrez `index.html` dans un navigateur.
2. Depuis l'écran d'accueil, connectez-vous en mode admin (bouton "Gestion des données") pour importer votre fichier CSV.
3. Une fois les données chargées, explorez la carte, le tableau et les statistiques via le menu de navigation.

## Technologies utilisées

- HTML / CSS / JavaScript (aucun framework, aucune dépendance de build)
- [Leaflet](https://leafletjs.com/) pour la cartographie
- [Chart.js](https://www.chartjs.org/) pour les graphiques
- [Font Awesome](https://fontawesome.com/) pour les icônes

## Licence

Projet interne — à adapter selon vos besoins.
