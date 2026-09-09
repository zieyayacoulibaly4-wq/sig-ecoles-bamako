"use strict";

require("dotenv").config();

const pool = require("./db");

(async () => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        current_user AS user_name,
        inet_server_addr() AS server_address,
        inet_server_port() AS server_port,
        NOW() AS server_time
    `);

    console.log("");
    console.log("==========================================");
    console.log(" CONNEXION POSTGRESQL : OK");
    console.log("==========================================");

    console.table(result.rows);

    const count = await pool.query(`
      SELECT COUNT(*)::bigint AS total_ecoles
      FROM public.ecoles
    `);

    console.log(
      "Nombre d'écoles dans public.ecoles :",
      count.rows[0].total_ecoles
    );

    console.log("==========================================");
    console.log("");
  } catch (err) {
    console.error("");
    console.error("==========================================");
    console.error(" CONNEXION POSTGRESQL : ECHEC");
    console.error("==========================================");
    console.error("Code    :", err.code || "inconnu");
    console.error("Message :", err.message);
    console.error("==========================================");
    console.error("");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

