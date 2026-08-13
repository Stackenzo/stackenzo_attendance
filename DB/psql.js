const { Pool } = require("pg");
require("dotenv").config()
const pool = new Pool({
    host: "100.117.158.50",
    port: 5432,
    user: "admin",
    password: "admin",
    database: "stackenzo_attendance",
});

async function connectDB() {
    try {
        const client = await pool.connect();
        console.log("✅ PostgreSQL Connected");

        client.release(); 

        return pool;
    } catch (err) {
        console.error("❌ Database connection failed:", err.message);

        console.log("Retrying in 10 seconds...");
        setTimeout(connectDB, 10000);
    }
}

module.exports = {connectDB,pool};