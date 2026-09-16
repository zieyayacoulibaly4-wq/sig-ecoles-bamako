import pandas as pd
import os
import sys

sys.path.append(
    os.path.dirname(
        os.path.dirname(
            os.path.abspath(__file__)
        )
    )
)

from database.postgres import connecter_postgres


def convertir_localisation(valeur):
    if pd.isna(valeur):
        return None, None, None

    valeurs = str(valeur).strip().split()

    latitude = None
    longitude = None
    altitude = None

    if len(valeurs) >= 1:
        latitude = float(valeurs[0])

    if len(valeurs) >= 2:
        longitude = float(valeurs[1])

    if len(valeurs) >= 3:
        altitude = float(valeurs[2])

    return latitude, longitude, altitude


def convertir_commune(valeur):
    if pd.isna(valeur):
        return None

    commune = str(valeur).strip().lower()

    correspondances = {
        "commune1": "Commune I",
        "commune2": "Commune II",
        "commune3": "Commune III",
        "commune4": "Commune IV",
        "commune5": "Commune V",
        "commune6": "Commune VI"
    }

    return correspondances.get(
        commune,
        str(valeur).strip()
    )


def synchroniser_postgres():

    fichier = os.path.join(
        os.path.dirname(
            os.path.dirname(
                os.path.abspath(__file__)
            )
        ),
        "kobo",
        "ecoles_bamako.csv"
    )

    print("Lecture du fichier CSV...")

    df = pd.read_csv(
        fichier,
        encoding="utf-8-sig"
    )

    print("Nombre de lignes :", len(df))

    connexion = connecter_postgres()
    curseur = connexion.cursor()

    print("Connexion PostgreSQL réussie.")

    for _, ligne in df.iterrows():

        latitude, longitude, altitude = convertir_localisation(
            ligne.get("localisation")
        )

        commune = convertir_commune(
            ligne.get("commune")
        )

        curseur.execute(
            """
            INSERT INTO ecoles (
                id_ecole,
                nom_ecole,
                type_ecole,
                niveau,
                commune,
                quartier,
                latitude,
                longitude,
                altitude,
                effectif_total,
                nombre_classes,
                statut_fonctionnement,
                annee_creation,
                source_donnee,
                date_collecte
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s
            )

            ON CONFLICT (id_ecole)
            DO UPDATE SET
                nom_ecole = EXCLUDED.nom_ecole,
                type_ecole = EXCLUDED.type_ecole,
                niveau = EXCLUDED.niveau,
                commune = EXCLUDED.commune,
                quartier = EXCLUDED.quartier,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                altitude = EXCLUDED.altitude,
                effectif_total = EXCLUDED.effectif_total,
                nombre_classes = EXCLUDED.nombre_classes,
                statut_fonctionnement = EXCLUDED.statut_fonctionnement,
                annee_creation = EXCLUDED.annee_creation,
                source_donnee = EXCLUDED.source_donnee,
                date_collecte = EXCLUDED.date_collecte
            """,
            (
                ligne.get("id_ecole"),
                ligne.get("nom_ecole"),
                ligne.get("type_ecole"),
                ligne.get("niveau"),
                commune,
                ligne.get("quartier"),
                latitude,
                longitude,
                altitude,
                ligne.get("effectif_total"),
                ligne.get("nombre_classes"),
                ligne.get("statut_fonctionnement"),
                ligne.get("annee_creation"),
                ligne.get("source_donnee"),
                ligne.get("_submission_time")
            )
        )

    connexion.commit()

    curseur.close()
    connexion.close()

    print("Synchronisation PostgreSQL terminée.")
    print("Nombre d'écoles synchronisées :", len(df))


if __name__ == "__main__":
    synchroniser_postgres()