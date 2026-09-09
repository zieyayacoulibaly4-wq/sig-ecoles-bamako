"use strict";

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "ecoles_bamako",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Erreur inattendue du pool PostgreSQL :", err);
});

module.exports = pool;

