# ============================================================
# SYNCHRONISATION KOBO TOOLBOX -> POSTGRESQL
# Projet SIG des écoles de Bamako
# ============================================================

import requests
import psycopg2
from datetime import datetime


# ============================================================
# CONFIGURATION KOBO
# ============================================================

KOBO_URL = (
    "https://kf.kobotoolbox.org/api/v2/assets/"
    "aVhFrfpVhTcBtMyCL35YFS/data/"
)

# Si ton formulaire Kobo nécessite un token,
# ajoute-le ici.
KOBO_TOKEN = "383b1dae88b8fb19a83ee5ec2c14be520d97ee72"

HEADERS = {
    "Accept": "application/json"
}

if KOBO_TOKEN:
    HEADERS["Authorization"] = f"Token {KOBO_TOKEN}"


# ============================================================
# CONFIGURATION POSTGRESQL
# ============================================================

DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "database": "ecoles_bamako",
    "user": "postgres",
    "password": "yaya"
}


# ============================================================
# CONNEXION POSTGRESQL
# ============================================================

def get_db_connection():

    print("Connexion à PostgreSQL...")

    conn = psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        database=DB_CONFIG["database"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"]
    )

    print("Connexion PostgreSQL réussie.")

    return conn


# ============================================================
# RECUPERATION DES DONNEES KOBO
# ============================================================

def get_kobo_data():

    print("Récupération des données KoboToolbox...")

    response = requests.get(
        KOBO_URL,
        headers=HEADERS,
        timeout=60
    )

    response.raise_for_status()

    data = response.json()

    print("Données Kobo récupérées.")

    return data


# ============================================================
# CONVERSION VALEUR
# ============================================================

def to_int(value):

    if value is None or value == "":
        return None

    try:
        return int(float(value))
    except:
        return None


def to_float(value):

    if value is None or value == "":
        return None

    try:
        return float(value)
    except:
        return None


# ============================================================
# EXTRACTION DES COORDONNEES
# ============================================================

def extract_coordinates(record):

    # Cas 1 : localisation sous forme :
    # "12.600892 -7.962715 0 0"

    localisation = record.get("localisation")

    if localisation:

        try:

            parts = localisation.replace(",", ".").split()

            if len(parts) >= 2:

                latitude = float(parts[0])
                longitude = float(parts[1])

                return latitude, longitude

        except:
            pass

    # Cas 2 : champs latitude / longitude séparés

    latitude = record.get("latitude")
    longitude = record.get("longitude")

    if latitude and longitude:

        try:
            return float(latitude), float(longitude)
        except:
            pass

    return None, None


# ============================================================
# INSERTION D'UNE ECOLE
# ============================================================

def insert_school(cursor, record):

    id_ecole = record.get("id_ecole")

    if not id_ecole:

        print("École ignorée : id_ecole absent.")

        return "erreur"


    # --------------------------------------------------------
    # Vérification doublon
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT 1
        FROM public.ecoles
        WHERE id_ecole = %s
        LIMIT 1
        """,
        (id_ecole,)
    )

    if cursor.fetchone():

        print(
            f"Doublon ignoré : {id_ecole}"
        )

        return "doublon"


    # --------------------------------------------------------
    # Coordonnées
    # --------------------------------------------------------

    latitude, longitude = extract_coordinates(record)


    # --------------------------------------------------------
    # Autres informations
    # --------------------------------------------------------

    nom_ecole = record.get("nom_ecole")

    type_ecole = record.get("type_ecole")

    niveau = record.get("niveau")

    commune = record.get("commune")

    quartier = record.get("quartier")

    adresse = record.get("adresse")

    effectif_total = to_int(
        record.get("effectif_total")
    )

    nombre_classes = to_int(
        record.get("nombre_classes")
    )

    statut_fonctionnement = record.get(
        "statut_fonctionnement"
    )

    annee_creation = to_int(
        record.get("annee_creation")
    )

    source_donnee = record.get(
        "source_donnee"
    )

    date_collecte = record.get(
        "date_collecte"
    )


    # --------------------------------------------------------
    # Date automatique
    # --------------------------------------------------------

    if not date_collecte:

        date_collecte = datetime.now().date()


    # --------------------------------------------------------
    # INSERTION POSTGRESQL
    # --------------------------------------------------------

    cursor.execute(
        """
        INSERT INTO public.ecoles
        (
            id_ecole,
            nom_ecole,
            type_ecole,
            niveau,
            commune,
            quartier,
            adresse,
            latitude,
            longitude,
            effectif_total,
            nombre_classes,
            statut_fonctionnement,
            annee_creation,
            source_donnee,
            date_collecte
        )
        VALUES
        (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        )
        """,
        (
            id_ecole,
            nom_ecole,
            type_ecole,
            niveau,
            commune,
            quartier,
            adresse,
            latitude,
            longitude,
            effectif_total,
            nombre_classes,
            statut_fonctionnement,
            annee_creation,
            source_donnee,
            date_collecte
        )
    )


    print(
        f"Nouvelle école importée : {id_ecole}"
    )

    return "nouvelle"


# ============================================================
# SYNCHRONISATION
# ============================================================

def synchronize():

    print()
    print("=" * 60)
    print("SYNCHRONISATION KOBO -> POSTGRESQL")
    print("=" * 60)
    print()


    # --------------------------------------------------------
    # 1. Récupérer Kobo
    # --------------------------------------------------------

    data = get_kobo_data()


    # --------------------------------------------------------
    # 2. Récupérer la liste des soumissions
    # --------------------------------------------------------

    if isinstance(data, dict):

        records = data.get("results", [])

    elif isinstance(data, list):

        records = data

    else:

        records = []


    print(
        f"Total soumissions Kobo : {len(records)}"
    )


    if not records:

        print("Aucune donnée Kobo trouvée.")

        return


    # --------------------------------------------------------
    # 3. Connexion PostgreSQL
    # --------------------------------------------------------

    conn = None

    nouvelles = 0
    doublons = 0
    erreurs = 0


    try:

        conn = get_db_connection()

        cursor = conn.cursor()


        # ----------------------------------------------------
        # 4. Importation
        # ----------------------------------------------------

        for record in records:

            try:

                result = insert_school(
                    cursor,
                    record
                )

                if result == "nouvelle":

                    nouvelles += 1

                elif result == "doublon":

                    doublons += 1

                else:

                    erreurs += 1


            except Exception as e:

                erreurs += 1

                print(
                    "Erreur lors de l'importation :",
                    e
                )

                conn.rollback()


        # ----------------------------------------------------
        # 5. Validation
        # ----------------------------------------------------

        conn.commit()


        cursor.close()


        print()
        print("=" * 60)
        print("IMPORTATION TERMINÉE")
        print("=" * 60)

        print(
            f"Nouvelles écoles : {nouvelles}"
        )

        print(
            f"Doublons ignorés : {doublons}"
        )

        print(
            f"Erreurs : {erreurs}"
        )

        print()
        print(
            f"Base utilisée : "
            f"{DB_CONFIG['database']}"
        )

        print(
            f"Serveur : "
            f"{DB_CONFIG['host']}:{DB_CONFIG['port']}"
        )

        print()


    except Exception as e:

        print()
        print("ERREUR POSTGRESQL")
        print("-" * 40)
        print(e)
        print()


    finally:

        if conn:

            conn.close()

            print(
                "Connexion PostgreSQL fermée."
            )


# ============================================================
# TEST POSTGRESQL
# ============================================================

def test_postgres():

    print()
    print("=" * 60)
    print("TEST DE CONNEXION POSTGRESQL")
    print("=" * 60)

    try:

        conn = get_db_connection()

        cursor = conn.cursor()

        cursor.execute(
            "SELECT version();"
        )

        version = cursor.fetchone()

        print()
        print("PostgreSQL fonctionne correctement.")
        print()
        print("Version :")
        print(version[0])

        cursor.close()

        conn.close()

    except Exception as e:

        print()
        print("Échec de connexion PostgreSQL.")
        print()
        print(e)


# ============================================================
# PROGRAMME PRINCIPAL
# ============================================================

if __name__ == "__main__":

    # Test PostgreSQL
    test_postgres()

    print()

    # Synchronisation Kobo -> PostgreSQL
    synchronize()