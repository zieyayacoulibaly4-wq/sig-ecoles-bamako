from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import client, db, ecoles_collection

# =========================================================
# COLLECTIONS SUPPLÉMENTAIRES
# ---------------------------------------------------------
# Pas besoin de modifier database.py : on récupère simplement
# deux collections de plus depuis la même base "db".
#   - meta_collection  : un seul document, infos sur l'import
#                        en cours (nom du fichier CSV, date).
#   - logos_collection : un document PAR école (_id = id_ecole),
#                        au lieu d'un unique gros document.
#     Chaque logo est ainsi indépendant des autres : ajouter ou
#     supprimer un logo ne touche jamais aux autres écoles.
# =========================================================

meta_collection = db["meta"]
logos_collection = db["logos"]


# =========================================================
# APPLICATION — UNE SEULE DÉCLARATION
# ---------------------------------------------------------
# CORRECTIF : "app = FastAPI(...)" était déclaré deux fois.
# La seconde déclaration écrasait la première et, avec elle,
# TOUT le middleware CORS ajouté juste après — c'est la cause
# la plus probable de l'échec de connexion depuis le frontend.
# =========================================================

app = FastAPI(
    title="SIG Écoles Bamako API",
    description="API de gestion des données géospatiales des établissements scolaires de Bamako",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)


# =========================================================
# MODÈLES DE DONNÉES (validation automatique des requêtes)
# =========================================================

class ImportPayload(BaseModel):
    fileName: Optional[str] = "données.csv"
    rows: List[Dict[str, Any]]


class LogoPayload(BaseModel):
    logo: str  # dataURL base64 (ex: "data:image/png;base64,...")


# =========================================================
# ROUTES DE BASE
# =========================================================

@app.get("/")
def accueil():
    return {
        "message": "API SIG Écoles Bamako opérationnelle"
    }


@app.get("/api/test-db")
def test_database():

    try:
        client.admin.command("ping")

        nombre_ecoles = ecoles_collection.count_documents({})

        return {
            "success": True,
            "database": db.name,
            "collection": "ecoles",
            "nombre_ecoles": nombre_ecoles
        }

    except Exception as erreur:

        return {
            "success": False,
            "message": str(erreur)
        }


# =========================================================
# ÉCOLES — LECTURE
# =========================================================

@app.get("/api/ecoles")
def obtenir_ecoles():

    try:

        ecoles = list(
            ecoles_collection.find(
                {},
                {"_id": 0}
            )
        )

        return {
            "success": True,
            "total": len(ecoles),
            "ecoles": ecoles
        }

    except Exception as erreur:

        raise HTTPException(status_code=500, detail=str(erreur))


# =========================================================
# ÉCOLES — IMPORT (remplace tout, comme le faisait Firestore)
# ---------------------------------------------------------
# CORRECTIF : la route qui manquait. Le frontend appelle
# POST /api/ecoles/import avec { fileName, rows } à chaque
# import CSV, et attend que ça remplace entièrement les
# données existantes (comportement identique à l'ancien
# SCHOOLS_DOC_REF.set(...) sur Firestore).
# =========================================================

@app.post("/api/ecoles/import")
def importer_ecoles(payload: ImportPayload):

    try:

        ecoles_collection.delete_many({})

        if payload.rows:
            ecoles_collection.insert_many(payload.rows)

        meta_collection.update_one(
            {"_id": "info"},
            {"$set": {
                "fileName": payload.fileName or "données.csv",
                "updatedAt": datetime.now(timezone.utc)
            }},
            upsert=True
        )

        return {
            "success": True,
            "total": len(payload.rows)
        }

    except Exception as erreur:

        raise HTTPException(status_code=500, detail=str(erreur))


@app.get("/api/meta")
def obtenir_meta():

    try:

        doc = meta_collection.find_one({"_id": "info"}, {"_id": 0})

        return {
            "success": True,
            "fileName": (doc or {}).get("fileName", "données.csv")
        }

    except Exception as erreur:

        raise HTTPException(status_code=500, detail=str(erreur))


# =========================================================
# LOGOS DES ÉTABLISSEMENTS
# ---------------------------------------------------------
# Un document par école (_id = id_ecole) plutôt qu'un seul
# gros document pour toutes les écoles : chaque ajout,
# remplacement ou suppression de logo est indépendant.
# =========================================================

@app.get("/api/logos")
def obtenir_logos():

    try:

        documents = list(logos_collection.find({}))

        logos = {doc["_id"]: doc["logo"] for doc in documents if "logo" in doc}

        return {
            "success": True,
            "logos": logos
        }

    except Exception as erreur:

        raise HTTPException(status_code=500, detail=str(erreur))


@app.put("/api/logos/{id_ecole}")
def enregistrer_logo(id_ecole: str, payload: LogoPayload):

    try:

        logos_collection.update_one(
            {"_id": id_ecole},
            {"$set": {
                "logo": payload.logo,
                "updatedAt": datetime.now(timezone.utc)
            }},
            upsert=True
        )

        return {"success": True}

    except Exception as erreur:

        raise HTTPException(status_code=500, detail=str(erreur))


@app.delete("/api/logos/{id_ecole}")
def supprimer_logo(id_ecole: str):

    try:

        logos_collection.delete_one({"_id": id_ecole})

        return {"success": True}

    except Exception as erreur:

        raise HTTPException(status_code=500, detail=str(erreur))


# =========================================================
# INDEX MONGODB
# ---------------------------------------------------------
# CORRECTIF : create_index("localisation", "2dsphere") n'est
# pas une syntaxe pymongo valide — cet appel levait une
# exception au démarrage et empêchait le serveur de démarrer
# correctement (donc aucune route ne répondait, JS ou pas).
#
# L'index géospatial "2dsphere" a aussi été retiré : il exige
# un champ au format GeoJSON ({ type: "Point", coordinates:
# [lon, lat] }), alors que les écoles stockent ici latitude et
# longitude comme deux champs numériques séparés. Un index
# classique sur ces deux champs suffit pour l'usage actuel
# (filtres, recherche) ; l'index géospatial pourra être ajouté
# plus tard si le format des coordonnées est adapté.
# =========================================================

@app.on_event("startup")
def creer_index():

    ecoles_collection.create_index("id_ecole", unique=True)
    ecoles_collection.create_index("commune")
    ecoles_collection.create_index("quartier")
    ecoles_collection.create_index("type_ecole")
    ecoles_collection.create_index("niveau")
    ecoles_collection.create_index("statut_fonctionnement")
    ecoles_collection.create_index([("latitude", 1), ("longitude", 1)])

    print("Index MongoDB créés avec succès.")
