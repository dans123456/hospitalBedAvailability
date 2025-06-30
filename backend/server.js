// backend/server.js
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise'); // MySQL driver for Node.js
const path = require('path'); // Used for path manipulation (though less needed now)
const cron = require('node-cron'); // For daily data snapshots

const app = express();
// Cloud Run services listen on the PORT environment variable, defaulting to 8080.
// Use process.env.PORT to allow Cloud Run to inject the correct port.
const PORT = process.env.PORT || 8080;

// --- Database Configuration for Google Cloud SQL (MySQL) ---
// These values will be injected as environment variables when deployed to Cloud Run.
// For local development, they will fall back to 'localhost', 'root', etc.
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',        // Cloud SQL Public IP (or 'localhost' for dev)
    user: process.env.DB_USER || ' hospital_app_user',             // Cloud SQL DB User (e.g., hospital_app_user)
    password: process.env.DB_PASSWORD || 'siaw8985', // Password for the DB User
    database: process.env.DB_NAME || 'hospital_beds_db', // Name of your application database
    waitForConnections: true, // Ensures connection is ready before queries
    connectionLimit: 10,      // Max number of connections in the pool
    queueLimit: 0             // No limit on connection queue
});

// Test database connection when the server starts
pool.getConnection()
    .then(connection => {
        console.log('Successfully connected to the MySQL database!');
        connection.release(); // Release the connection back to the pool
    })
    .catch(err => {
        console.error('MySQL database connection failed:', err);
        // Exiting the process is often good in cloud environments if DB connection is critical.
        process.exit(1);
    });

// --- Core Middleware ---
app.use(cors()); // Enables Cross-Origin Resource Sharing (allows frontend to call API)
app.use(express.json()); // Parses incoming JSON request bodies

// IMPORTANT: Cloud Run services do NOT serve static files (like HTML/CSS/JS).
// Your frontend is hosted separately on Google Cloud Storage.
// Therefore, remove the express.static middleware:
// app.use(express.static(path.join(__dirname, '../frontend')));


// ======== AUTHENTICATION MIDDLEWARE (Placeholder for Production) ======== //
// For demo purposes, this middleware allows all requests to pass through.
// In a production application, implement robust JWT-based authentication here.
const authenticateToken = (req, res, next) => {
    // Example placeholder for future JWT authentication:
    // const authHeader = req.headers['authorization'];
    // const token = authHeader && authHeader.split(' ')[1];
    // if (token == null) return res.sendStatus(401); // No token
    // jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    //     if (err) return res.sendStatus(403); // Invalid token
    //     req.user = user;
    //     next();
    // });
    console.log('Authentication placeholder: Allowing request for testing.');
    next(); // Proceed to the next middleware/route handler
};


// ======== DATA VALIDATION MIDDLEWARE ======== //
// Ensures incoming data for hospitals is valid before processing.
const validateHospitalData = (req, res, next) => {
    const { name, icuBeds, regularBeds, contactInfo, location, region } = req.body;
    const errors = [];

    if (!name || typeof name !== 'string' || name.trim().length < 3) {
        errors.push("Hospital name must be a string of at least 3 characters.");
    }
    const validRegions = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central",
                         "Eastern", "Greater Accra", "North East", "Northern",
                         "Oti", "Savannah", "Upper East", "Upper West",
                         "Volta", "Western", "Western North"];
    if (!region || !validRegions.includes(region)) {
        errors.push("Invalid or missing region selected.");
    }
    if (typeof icuBeds !== 'number' || icuBeds < 0 || !Number.isInteger(icuBeds)) {
        errors.push("ICU beds must be a non-negative integer.");
    }
    if (typeof regularBeds !== 'number' || regularBeds < 0 || !Number.isInteger(regularBeds)) {
        errors.push("Regular beds must be a non-negative integer.");
    }
    if (contactInfo && (typeof contactInfo !== 'string' || !/^[\d\s+()-]+$/.test(contactInfo))) {
        errors.push("Contact info must be a valid phone number format (digits, spaces, +, -, () only).");
    }
    if (location && (typeof location !== 'string' || location.length > 100)) {
        errors.push("Location must be a string under 100 characters.");
    }

    if (errors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: errors });
    }
    next(); // If validation passes, proceed
};


// --- API Endpoints ---

// GET all hospitals with optional search and region filters
app.get('/api/hospitals', async (req, res) => {
    const { search, region } = req.query;
    let sqlQuery = 'SELECT * FROM hospitals';
    const queryParams = [];
    const conditions = [];

    if (search) {
        conditions.push('name LIKE ?'); // MySQL placeholder '?'
        queryParams.push(`%${search}%`);
    }
    if (region) {
        conditions.push('region = ?');
        queryParams.push(region);
    }
    if (conditions.length > 0) {
        sqlQuery += ' WHERE ' + conditions.join(' AND ');
    }
    sqlQuery += ' ORDER BY timestamp DESC'; // Order by latest update

    try {
        const [rows] = await pool.query(sqlQuery, queryParams); // mysql2 returns [rows, fields]
        res.json(rows);
    } catch (err) {
        console.error('Error fetching hospitals:', err);
        res.status(500).json({ message: 'Failed to retrieve hospital data.' });
    }
});

// GET historical bed availability for a specific hospital
app.get('/api/hospitals/:id/history', async (req, res) => {
    const { id } = req.params;
    const { days = 7 } = req.query; // Default to 7 days of history

    if (isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Invalid hospital ID provided.' });
    }
    if (isNaN(parseInt(days)) || parseInt(days) <= 0) {
        return res.status(400).json({ message: 'Days parameter must be a positive number.' });
    }

    try {
        const [rows] = await pool.query(`
            SELECT
                DATE(recorded_at) AS date,
                AVG(icu_beds) AS avg_icu_beds,
                AVG(regular_beds) AS avg_regular_beds
            FROM hospital_history
            WHERE
                hospital_id = ? AND
                recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY DATE(recorded_at)
            ORDER BY date ASC
        `, [parseInt(id), parseInt(days)]); // Pass values for placeholders
        res.json(rows);
    } catch (err) {
        console.error(`Error fetching historical data for hospital ID ${id}:`, err);
        res.status(500).json({ message: 'Failed to load historical data.' });
    }
});

// POST a new hospital or UPDATE an existing one (UPSERT logic based on name)
app.post('/api/hospitals', authenticateToken, validateHospitalData, async (req, res) => {
    const { name, icuBeds, regularBeds, contactInfo, location, region } = req.body;

    try {
        // Check if hospital already exists by name (case-insensitive)
        const [existingHospitalRows] = await pool.query(
            'SELECT id FROM hospitals WHERE LOWER(name) = LOWER(?)',
            [name]
        );

        // Get current timestamp (MySQL DATETIME format)
        const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

        if (existingHospitalRows.length > 0) {
            // Hospital exists, update its details
            const hospitalId = existingHospitalRows[0].id;

            // Record history before updating main hospital data
            await pool.query(
                'INSERT INTO hospital_history (hospital_id, icu_beds, regular_beds) VALUES (?, ?, ?)',
                [hospitalId, icuBeds, regularBeds]
            );

            const updateQuery = `
                UPDATE hospitals
                SET icu_beds = ?, regular_beds = ?, contact_info = ?, location = ?, region = ?, timestamp = ?
                WHERE id = ?;
            `;
            await pool.query(updateQuery, [icuBeds, regularBeds, contactInfo, location, region, currentTimestamp, hospitalId]);

            const [updatedRow] = await pool.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
            res.status(200).json(updatedRow[0]); // Return the updated hospital data
        } else {
            // Hospital does not exist, insert a new one
            const insertQuery = `
                INSERT INTO hospitals (name, icu_beds, regular_beds, contact_info, location, region, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            `;
            const [insertResult] = await pool.query(insertQuery, [name, icuBeds, regularBeds, contactInfo, location, region, currentTimestamp]);

            const newHospitalId = insertResult.insertId; // Get the auto-generated ID

            // Record initial history for the newly created hospital
            await pool.query(
                'INSERT INTO hospital_history (hospital_id, icu_beds, regular_beds) VALUES (?, ?, ?)',
                [newHospitalId, icuBeds, regularBeds]
            );

            const [newRow] = await pool.query('SELECT * FROM hospitals WHERE id = ?', [newHospitalId]);
            res.status(201).json(newRow[0]); // Return the newly created hospital data (201 Created)
        }
    } catch (err) {
        console.error('Error saving hospital data:', err);
        res.status(500).json({ message: 'Failed to save hospital data due to an internal server error.' });
    }
});

// DELETE a hospital entry
app.delete('/api/hospitals/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'A valid hospital ID is required for deletion.' });
    }

    try {
        // Deleting from 'hospitals' table will trigger CASCADE DELETE for 'hospital_history'
        const deleteQuery = 'DELETE FROM hospitals WHERE id = ?;';
        const [result] = await pool.query(deleteQuery, [parseInt(id)]);

        if (result.affectedRows > 0) { // Check if any row was affected/deleted
            res.status(200).json({ message: 'Hospital deleted successfully.' });
        } else {
            res.status(404).json({ message: 'Hospital not found or already deleted.' });
        }
    } catch (err) {
        console.error(`Error deleting hospital data for ID ${id}:`, err);
        res.status(500).json({ message: 'Failed to delete hospital data due to an internal server error.' });
    }
});


// --- Cron Job for Daily Snapshots ---
// This cron job runs daily at 11 PM (23:00) to record current bed availability.
// IMPORTANT: In Cloud Run, multiple instances might run this cron. For a single scheduled task,
// consider using Cloud Scheduler + Cloud Pub/Sub to trigger a specific endpoint.
cron.schedule('0 23 * * *', async () => {
    console.log('[CRON JOB] Recording daily hospital snapshot...');
    try {
        const [hospitals] = await pool.query('SELECT id, icu_beds, regular_beds FROM hospitals');
        for (const hospital of hospitals) {
            await pool.query(
                'INSERT INTO hospital_history (hospital_id, icu_beds, regular_beds) VALUES (?, ?, ?)',
                [hospital.id, hospital.icu_beds, hospital.regular_beds]
            );
        }
        console.log(`[CRON JOB] Successfully recorded snapshots for ${hospitals.length} hospitals.`);
    } catch (err) {
        console.error('[CRON JOB] Daily snapshot failed:', err);
    }
});


// IMPORTANT: Remove this catch-all route. Cloud Run is for your API, not for serving frontend.
// The frontend is served separately from Google Cloud Storage.
// app.get('/*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../frontend/index.html'));
// });


// --- Starting the Server ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // No need to log frontend URL here, as it's separate.
    console.log(`API available at paths like /api/hospitals`);
});
