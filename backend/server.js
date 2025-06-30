const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Configuration for MySQL ---
// --- Database Configuration for MySQL ---
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',        // Get from env, fallback to localhost
    user: process.env.DB_USER || 'root',             // Get from env, fallback to root
    password: process.env.DB_PASSWORD || 'siaw8985', // Get from env, fallback for local
    database: process.env.DB_NAME || 'hospital_beds_db', // Get from env, fallback for local
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
pool.getConnection()
    .then(connection => {
        console.log('Successfully connected to the MySQL database!');
        connection.release();
    })
    .catch(err => {
        console.error('MySQL database connection failed:', err);
        // Exit process if DB connection fails on startup, as app cannot function
        process.exit(1);
    });

// --- Core Middleware ---
app.use(cors()); // Enables Cross-Origin Resource Sharing for frontend access
app.use(express.json()); // Parses incoming JSON requests
app.use(express.static(path.join(__dirname, '../frontend'))); // Serves static files from the 'frontend' directory

// ======== AUTHENTICATION MIDDLEWARE (Placeholder for Production) ======== //
// IMPORTANT: This is a placeholder for demonstration and local testing purposes.
// For production, you MUST implement robust authentication (e.g., using JWTs, OAuth).
// This middleware currently allows all requests to proceed.
const authenticateToken = (req, res, next) => {
    // In a real application, you'd typically verify a token sent in the Authorization header.
    // Example (requires 'jsonwebtoken' package and a secret key):
    /*
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Expected format: "Bearer TOKEN"
    if (token == null) {
        console.warn("Authentication: No token provided.");
        return res.sendStatus(401); // No token provided
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) {
            console.warn("Authentication: Invalid token.", err.message);
            return res.sendStatus(403); // Invalid token
        }
        req.user = user; // Store user payload in request for later use
        console.log("Authentication: Token verified for user:", user.username || user.id);
        next(); // Proceed to the next middleware/route handler
    });
    */
    console.log('Authentication placeholder: Allowing request for testing.');
    next(); // For now, just allow all requests to proceed for demo purposes.
};


// ======== DATA VALIDATION MIDDLEWARE ======== //
const validateHospitalData = (req, res, next) => {
    const { name, icuBeds, regularBeds, contactInfo, location, region } = req.body;
    const errors = [];

    // Name validation
    if (!name || typeof name !== 'string' || name.trim().length < 3) {
        errors.push("Hospital name must be a string of at least 3 characters.");
    }

    // Region validation
    const validRegions = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central",
                         "Eastern", "Greater Accra", "North East", "Northern",
                         "Oti", "Savannah", "Upper East", "Upper West",
                         "Volta", "Western", "Western North"];
    if (!region || !validRegions.includes(region)) {
        errors.push("Invalid or missing region selected.");
    }

    // Bed counts validation
    // Ensure they are numbers and non-negative integers
    if (typeof icuBeds !== 'number' || icuBeds < 0 || !Number.isInteger(icuBeds)) {
        errors.push("ICU beds must be a non-negative integer.");
    }
    if (typeof regularBeds !== 'number' || regularBeds < 0 || !Number.isInteger(regularBeds)) {
        errors.push("Regular beds must be a non-negative integer.");
    }

    // Contact info validation (optional but good practice)
    // Basic regex for common phone number characters, allows for flexibility
    if (contactInfo && (typeof contactInfo !== 'string' || (contactInfo && !/^[\d\s+()-]+$/.test(contactInfo)))) {
        errors.push("Contact info must be a valid phone number format (digits, spaces, +, -, () only).");
    }

    // Location validation (basic string length)
    if (location && (typeof location !== 'string' || (location && location.length > 100))) {
        errors.push("Location must be a string under 100 characters.");
    }

    if (errors.length > 0) {
        // Send a 400 Bad Request with validation errors
        return res.status(400).json({ message: 'Validation failed.', errors: errors });
    }

    next(); // If validation passes, proceed to the route handler
};

// --- API Endpoints ---

// GET all hospitals with optional search and region filters
app.get('/api/hospitals', async (req, res) => {
    const { search, region } = req.query;

    let sqlQuery = 'SELECT * FROM hospitals';
    const queryParams = [];
    const conditions = [];

    if (search) {
        conditions.push('name LIKE ?');
        queryParams.push(`%${search}%`);
    }

    if (region) {
        conditions.push('region = ?');
        queryParams.push(region);
    }

    if (conditions.length > 0) {
        sqlQuery += ' WHERE ' + conditions.join(' AND ');
    }

    sqlQuery += ' ORDER BY timestamp DESC'; // Always order by latest update

    try {
        const [rows] = await pool.query(sqlQuery, queryParams);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching hospitals:', err);
        res.status(500).json({ message: 'Failed to retrieve hospital data.' });
    }
});

// GET historical bed availability for a specific hospital (example endpoint)
app.get('/api/hospitals/:id/history', async (req, res) => {
    const { id } = req.params;
    const { days = 7 } = req.query; // Default to 7 days of history

    // Validate ID and days parameters
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
        `, [parseInt(id), parseInt(days)]); // Ensure id and days are integers for query

        res.json(rows);
    } catch (err) {
        console.error(`Error fetching historical data for hospital ID ${id}:`, err);
        res.status(500).json({ message: 'Failed to load historical data.' });
    }
});

// POST a new hospital or UPDATE an existing one (UPSERT logic)
// Requires authentication (via placeholder) and data validation
app.post('/api/hospitals', authenticateToken, validateHospitalData, async (req, res) => {
    const { name, icuBeds, regularBeds, contactInfo, location, region } = req.body;

    // Frontend validation is mirrored here for robustness, but validateHospitalData handles it
    // if (!name || !region) {
    //     return res.status(400).json({ message: 'Hospital name and region are required.' });
    // }

    try {
        // Check if hospital already exists by name (case-insensitive search for uniqueness)
        const [existingHospitalRows] = await pool.query(
            'SELECT id FROM hospitals WHERE LOWER(name) = LOWER(?)',
            [name]
        );

        // Get current timestamp for update/insert
        const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

        if (existingHospitalRows.length > 0) {
            // Hospital exists, update it
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

            // Fetch the updated row to return
            const [updatedRow] = await pool.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
            res.status(200).json(updatedRow[0]); // Return the updated hospital data
        } else {
            // Hospital does not exist, insert new one
            const insertQuery = `
                INSERT INTO hospitals (name, icu_beds, regular_beds, contact_info, location, region, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            `;
            const [insertResult] = await pool.query(insertQuery, [name, icuBeds, regularBeds, contactInfo, location, region, currentTimestamp]);

            const newHospitalId = insertResult.insertId;

            // Record initial history for the newly created hospital
            await pool.query(
                'INSERT INTO hospital_history (hospital_id, icu_beds, regular_beds) VALUES (?, ?, ?)',
                [newHospitalId, icuBeds, regularBeds]
            );

            // Fetch the newly inserted row to return
            const [newRow] = await pool.query('SELECT * FROM hospitals WHERE id = ?', [newHospitalId]);
            res.status(201).json(newRow[0]); // Return the newly created hospital data (201 Created)
        }
    } catch (err) {
        console.error('Error saving hospital data:', err);
        // Distinguish between database errors and validation errors more clearly if needed
        res.status(500).json({ message: 'Failed to save hospital data due to an internal server error.' });
    }
});

// DELETE a hospital entry
// Requires authentication (via placeholder)
app.delete('/api/hospitals/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    // Basic validation for ID parameter
    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'A valid hospital ID is required for deletion.' });
    }

    try {
        // Deleting from 'hospitals' table will CASCADE DELETE to 'hospital_history'
        // if your foreign key constraint is set up with ON DELETE CASCADE.
        const deleteQuery = 'DELETE FROM hospitals WHERE id = ?;';
        const [result] = await pool.query(deleteQuery, [parseInt(id)]); // Ensure ID is integer

        if (result.affectedRows > 0) {
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
// This job runs every day at 11 PM (23:00) to record current bed availability.
// This helps build historical data for the charts.
cron.schedule('0 23 * * *', async () => {
    console.log('Recording daily hospital snapshot...');
    try {
        // Fetch current bed counts for all hospitals
        const [hospitals] = await pool.query('SELECT id, icu_beds, regular_beds FROM hospitals');

        // Insert a historical record for each hospital
        for (const hospital of hospitals) {
            await pool.query(
                'INSERT INTO hospital_history (hospital_id, icu_beds, regular_beds) VALUES (?, ?, ?)',
                [hospital.id, hospital.icu_beds, hospital.regular_beds]
            );
        }
        console.log(`Successfully recorded snapshots for ${hospitals.length} hospitals.`);
    } catch (err) {
        console.error('Daily snapshot failed:', err);
    }
});

// --- Catch-all route for Frontend (serves index.html for any unmatched route) ---
// This enables client-side routing, so refreshing a dashboard page still works.
app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// --- Starting the Server ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Frontend served at: http://localhost:${PORT}`);
    console.log(`API available at: http://localhost:${PORT}/api/hospitals`);
});
