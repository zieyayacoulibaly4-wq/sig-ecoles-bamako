import os
import sys

sys.path.append(
    os.path.dirname(
        os.path.dirname(
            os.path.abspath(__file__)
        )
    )
)

from supabase import create_client

from config import (
    SUPABASE_URL,
    SUPABASE_KEY
)

from database.postgres import connecter_postgres


def convertir_valeur(valeur):

    if valeur is None:
        return None

    if hasattr(valeur, "isoformat"):
        return valeur.isoformat()

    return valeur


def recuperer_ecoles_postgres():

    connexion = connecter_postgres()

    curseur = connexion.cursor()

    curseur.execute(
        """
        SELECT
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
        FROM ecoles
        """
    )

    colonnes = [
        "id_ecole",
        "nom_ecole",
        "type_ecole",
        "niveau",
        "commune",
        "quartier",
        "latitude",
        "longitude",
        "altitude",
        "effectif_total",
        "nombre_classes",
        "statut_fonctionnement",
        "annee_creation",
        "source_donnee",
        "date_collecte"
    ]

    resultats = curseur.fetchall()

    ecoles = []

    for ligne in resultats:

        ecole = {}

        for i in range(len(colonnes)):

            ecole[colonnes[i]] = convertir_valeur(
                ligne[i]
            )

        ecoles.append(ecole)

    curseur.close()
    connexion.close()

    return ecoles


def synchroniser_supabase():

    print("Connexion à PostgreSQL...")

    ecoles = recuperer_ecoles_postgres()

    print(
        "Nombre d'écoles récupérées depuis PostgreSQL :",
        len(ecoles)
    )

    if len(ecoles) == 0:
        print("Aucune école à synchroniser.")
        return

    print("Connexion à Supabase...")

    supabase = create_client(
        SUPABASE_URL,
        SUPABASE_KEY
    )

    print("Envoi des données vers Supabase...")

    supabase.table("ecoles").upsert(
        ecoles,
        on_conflict="id_ecole"
    ).execute()

    print("Synchronisation Supabase terminée.")
    print("Nombre d'écoles envoyées :", len(ecoles))


if __name__ == "__main__":
    synchroniser_supabase()