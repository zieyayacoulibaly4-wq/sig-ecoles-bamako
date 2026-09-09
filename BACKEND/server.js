// ============================================================
// SIG ÉCOLES DE BAMAKO
// Backend Node.js / Express
// Connexion : PostgreSQL → API REST → Frontend
// ============================================================

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = 4000;

const pool = new Pool({
    host: "localhost",
    port: 5433,
    database: "ecoles_bamako",
    user: "postgres",
    password: "yaya"
});

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());
app.use(express.json());

// Permet de servir ton frontend si index.html est dans "public"
app.use(express.static("public"));

// ============================================================
// TEST DE CONNEXION POSTGRESQL
// ============================================================

app.get("/api/test-db", async (req, res) => {

    try {

        const result = await pool.query("SELECT NOW() AS heure");

        res.json({
            success: true,
            message: "Connexion PostgreSQL réussie",
            serveur: result.rows[0].heure
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
// GET — TOUTES LES ÉCOLES
// ============================================================

app.get("/api/ecoles", async (req, res) => {

    try {

        const query = `
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
        `;

        const result = await pool.query(query);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {

        console.error("Erreur récupération écoles :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des écoles",
            error: error.message
        });
    }
});

// ============================================================
// GET — UNE ÉCOLE PAR ID
// ============================================================

app.get("/api/ecoles/:id", async (req, res) => {

    try {

        const { id } = req.params;

        const query = `
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
            LIMIT 1
        `;

        const result = await pool.query(query, [id]);

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
            message: "Erreur lors de la recherche",
            error: error.message
        });
    }
});

// ============================================================
// GET — STATISTIQUES
// ============================================================

app.get("/api/statistiques", async (req, res) => {

    try {

        const query = `
            SELECT
                COUNT(*) AS total_ecoles,

                COALESCE(SUM(effectif_total), 0) AS total_eleves,

                COALESCE(SUM(nombre_classes), 0) AS total_classes,

                COUNT(*) FILTER (
                    WHERE LOWER(statut_fonctionnement) = 'fonctionnel'
                ) AS ecoles_fonctionnelles

            FROM public.ecoles
        `;

        const result = await pool.query(query);

        const stats = result.rows[0];

        const total = Number(stats.total_ecoles);
        const fonctionnelles = Number(stats.ecoles_fonctionnelles);

        const tauxFonctionnel =
            total > 0
                ? ((fonctionnelles / total) * 100).toFixed(1)
                : "0.0";

        res.json({
            success: true,
            data: {
                total_ecoles: total,
                total_eleves: Number(stats.total_eleves),
                total_classes: Number(stats.total_classes),
                ecoles_fonctionnelles: fonctionnelles,
                taux_fonctionnel: Number(tauxFonctionnel)
            }
        });

    } catch (error) {

        console.error("Erreur statistiques :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur lors du calcul des statistiques",
            error: error.message
        });
    }
});

// ============================================================
// GET — ÉCOLES PAR COMMUNE
// ============================================================

app.get("/api/statistiques/communes", async (req, res) => {

    try {

        const query = `
            SELECT
                commune,
                COUNT(*) AS nombre_ecoles,
                COALESCE(SUM(effectif_total), 0) AS nombre_eleves,
                COALESCE(SUM(nombre_classes), 0) AS nombre_classes
            FROM public.ecoles
            GROUP BY commune
            ORDER BY commune ASC
        `;

        const result = await pool.query(query);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        console.error("Erreur statistiques communes :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur statistiques communes",
            error: error.message
        });
    }
});

// ============================================================
// GET — ÉCOLES PAR TYPE
// ============================================================

app.get("/api/statistiques/types", async (req, res) => {

    try {

        const query = `
            SELECT
                type_ecole,
                COUNT(*) AS nombre_ecoles
            FROM public.ecoles
            GROUP BY type_ecole
            ORDER BY type_ecole ASC
        `;

        const result = await pool.query(query);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        console.error("Erreur statistiques types :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur statistiques types",
            error: error.message
        });
    }
});

// ============================================================
// GET — ÉCOLES PAR NIVEAU
// ============================================================

app.get("/api/statistiques/niveaux", async (req, res) => {

    try {

        const query = `
            SELECT
                niveau,
                COUNT(*) AS nombre_ecoles
            FROM public.ecoles
            GROUP BY niveau
            ORDER BY niveau ASC
        `;

        const result = await pool.query(query);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        console.error("Erreur statistiques niveaux :", error.message);

        res.status(500).json({
            success: false,
            message: "Erreur statistiques niveaux",
            error: error.message
        });
    }
});

// ============================================================
// RECHERCHE D'ÉCOLES
// ============================================================

app.get("/api/recherche", async (req, res) => {

    try {

        const recherche = (req.query.q || "").trim();

        if (!recherche) {

            return res.json({
                success: true,
                total: 0,
                data: []
            });
        }

        const query = `
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
                OR commune ILIKE $1
                OR quartier ILIKE $1
                OR adresse ILIKE $1
            ORDER BY nom_ecole ASC
            LIMIT 500
        `;

        const result = await pool.query(query, [`%${recherche}%`]);

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
// ROUTE PRINCIPALE
// ============================================================

app.get("/api", (req, res) => {

    res.json({
        nom: "SIG Écoles de Bamako",
        version: "1.0.0",
        status: "API opérationnelle",
        endpoints: [
            "/api/test-db",
            "/api/ecoles",
            "/api/ecoles/:id",
            "/api/statistiques",
            "/api/statistiques/communes",
            "/api/statistiques/types",
            "/api/statistiques/niveaux",
            "/api/recherche?q=..."
        ]
    });
});

// ============================================================
// GESTION DES ERREURS
// ============================================================

app.use((err, req, res, next) => {

    console.error("Erreur serveur :", err);

    res.status(500).json({
        success: false,
        message: "Erreur interne du serveur"
    });
});

// ============================================================
// DÉMARRAGE DU SERVEUR
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

