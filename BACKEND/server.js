"use strict";

// ============================================================
// SIG ÉCOLES DE BAMAKO
// Backend Node.js / Express
// Connexion : PostgreSQL → API REST → Frontend
// ============================================================

// Charger les variables du fichier .env AVANT db.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 4000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());
app.use(express.json());

// ============================================================
// ROUTE PRINCIPALE
// ============================================================

app.get("/api", (req, res) => {
    res.json({
        success: true,
        message: "API SIG Écoles de Bamako opérationnelle",
        version: "1.0.0"
    });
});

// ============================================================
// TEST CONNEXION POSTGRESQL
// ============================================================

app.get("/api/test-db", async (req, res) => {

    try {

        const result = await pool.query("SELECT NOW() AS date_serveur");

        res.json({
            success: true,
            message: "Connexion PostgreSQL réussie",
            database: process.env.DB_NAME || "ecoles_bamako",
            server: (process.env.DB_HOST || "127.0.0.1") + ":" + (process.env.DB_PORT || 5433),
            date_serveur: result.rows[0].date_serveur
        });

    } catch (error) {

        console.error("Erreur PostgreSQL :", error.message);

        res.status(500).json({
            success: false,
            message: "Impossible de se connecter à PostgreSQL",
            error: error.message
        });

    }

});

// ============================================================
// RÉCUPÉRER TOUTES LES ÉCOLES
// ============================================================

app.get("/api/ecoles", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
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
            FROM public.ecoles
            ORDER BY nom_ecole ASC
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {

        console.error("Erreur récupération écoles :", error.message);

        res.status(500).json({
            success: false,
            message: "Impossible de charger les écoles",
            error: error.message
        });

    }

});

// ============================================================
// RÉCUPÉRER UNE ÉCOLE PAR SON ID
// ============================================================

app.get("/api/ecoles/:id", async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(
            `
            SELECT
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
            FROM public.ecoles
            WHERE id_ecole = $1
            `,
            [id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "École introuvable"
            });

        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        console.error("Erreur école :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération de l'école",
            error: error.message
        });

    }

});

// ============================================================
// RECHERCHE
// ============================================================

app.get("/api/recherche", async (req, res) => {

    try {

        const q = String(req.query.q || "").trim();

        if (!q) {

            return res.json({
                success: true,
                total: 0,
                data: []
            });

        }

        const recherche = `%${q}%`;

        const result = await pool.query(
            `
            SELECT
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
            FROM public.ecoles
            WHERE
                nom_ecole ILIKE $1
                OR id_ecole ILIKE $1
                OR type_ecole ILIKE $1
                OR niveau ILIKE $1
                OR commune ILIKE $1
                OR quartier ILIKE $1
                OR adresse ILIKE $1
                OR statut_fonctionnement ILIKE $1
            ORDER BY nom_ecole ASC
            `,
            [recherche]
        );

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {

        console.error("Erreur recherche :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur lors de la recherche",
            error: error.message
        });

    }

});

// ============================================================
// STATISTIQUES GÉNÉRALES
// ============================================================

app.get("/api/statistiques", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT

                COUNT(*) AS total_ecoles,

                COALESCE(
                    SUM(effectif_total),
                    0
                ) AS total_eleves,

                COALESCE(
                    SUM(nombre_classes),
                    0
                ) AS total_classes,

                COUNT(*) FILTER (
                    WHERE LOWER(TRIM(statut_fonctionnement))
                    = 'fonctionnel'
                ) AS ecoles_fonctionnelles,

                COUNT(*) FILTER (
                    WHERE LOWER(TRIM(statut_fonctionnement))
                    = 'non fonctionnel'
                ) AS ecoles_non_fonctionnelles

            FROM public.ecoles
        `);

        const data = result.rows[0];

        const total = Number(data.total_ecoles || 0);
        const fonctionnelles =
            Number(data.ecoles_fonctionnelles || 0);

        const taux =
            total > 0
                ? (fonctionnelles / total) * 100
                : 0;

        res.json({
            success: true,

            data: {
                total_ecoles: total,
                total_eleves: Number(data.total_eleves || 0),
                total_classes: Number(data.total_classes || 0),
                ecoles_fonctionnelles: fonctionnelles,
                ecoles_non_fonctionnelles:
                    Number(data.ecoles_non_fonctionnelles || 0),
                taux_fonctionnement:
                    Number(taux.toFixed(2))
            }
        });

    } catch (error) {

        console.error("Erreur statistiques :", error.message);

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les statistiques",
            error: error.message
        });

    }

});

// ============================================================
// STATISTIQUES PAR COMMUNE
// ============================================================

app.get("/api/statistiques/communes", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                commune,
                COUNT(*) AS total_ecoles,
                COALESCE(SUM(effectif_total), 0) AS total_eleves,
                COALESCE(SUM(nombre_classes), 0) AS total_classes
            FROM public.ecoles
            GROUP BY commune
            ORDER BY total_ecoles DESC
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {

        console.error(
            "Erreur statistiques communes :",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les statistiques par commune",
            error: error.message
        });

    }

});

// ============================================================
// STATISTIQUES PAR TYPE
// ============================================================

app.get("/api/statistiques/types", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                type_ecole,
                COUNT(*) AS total_ecoles
            FROM public.ecoles
            GROUP BY type_ecole
            ORDER BY total_ecoles DESC
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {

        console.error(
            "Erreur statistiques types :",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les statistiques par type",
            error: error.message
        });

    }

});

// ============================================================
// STATISTIQUES PAR NIVEAU
// ============================================================

app.get("/api/statistiques/niveaux", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                niveau,
                COUNT(*) AS total_ecoles
            FROM public.ecoles
            GROUP BY niveau
            ORDER BY total_ecoles DESC
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {

        console.error(
            "Erreur statistiques niveaux :",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les statistiques par niveau",
            error: error.message
        });

    }

});

// ============================================================
// GESTION DES ERREURS
// ============================================================

app.use((req, res) => {

    res.status(404).json({
        success: false,
        message: "Route API introuvable"
    });

});

// ============================================================
// DÉMARRAGE SERVEUR
// ============================================================

app.listen(PORT, () => {

    console.log("");
    console.log("==============================================");
    console.log("     SIG ÉCOLES DE BAMAKO");
    console.log("==============================================");
    console.log(`API : http://localhost:${PORT}`);
    console.log(`Écoles : http://localhost:${PORT}/api/ecoles`);
    console.log(`Test DB : http://localhost:${PORT}/api/test-db`);
    console.log(`Stats : http://localhost:${PORT}/api/statistiques`);
    console.log("==============================================");
    console.log("");

});

