const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'college_voting',  // Make sure this matches your actual database name
    port: 3306
});

connection.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('✅ Connected to MySQL database: college_voting');
});

// Handle database errors
connection.on('error', (err) => {
    console.error('Database error:', err);
});

module.exports = connection;