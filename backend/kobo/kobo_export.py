import requests
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

from config import KOBO_TOKEN, KOBO_ASSET_UID


URL = "https://kf.kobotoolbox.org/api/v2/assets/" + KOBO_ASSET_UID + "/data/"


def exporter_kobo():

    print("Connexion à KoboToolbox...")

    headers = {
        "Authorization": "Token " + KOBO_TOKEN
    }

    response = requests.get(
        URL,
        headers=headers
    )

    print("Code HTTP :", response.status_code)

    if response.status_code != 200:
        print("Erreur KoboToolbox")
        print(response.text)
        return

    data = response.json()

    results = data.get("results", [])

    print("Nombre de données reçues :", len(results))

    if len(results) == 0:
        print("Aucune donnée trouvée dans Kobo.")
        return

    df = pd.json_normalize(results)

    dossier = os.path.dirname(
        os.path.abspath(__file__)
    )

    fichier = os.path.join(
        dossier,
        "ecoles_bamako.csv"
    )

    df.to_csv(
        fichier,
        index=False,
        encoding="utf-8-sig"
    )

    print("Export Kobo terminé.")
    print("Nombre de lignes :", len(df))
    print("Fichier créé :", fichier)


if __name__ == "__main__":
    exporter_kobo()