const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Login page
router.get('/login', (req, res) => {
    res.render('auth/login', { error: null });
});

// Login process
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
    db.query(query, [username, password], (err, results) => {
        if (err) throw err;
        
        if (results.length > 0) {
            const user = results[0];
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                full_name: user.full_name,
                student_id: user.student_id
            };
            
            if (user.role === 'admin') {
                res.redirect('/admin/dashboard');
            } else {
                res.redirect('/student/dashboard');
            }
        } else {
            res.render('auth/login', { error: 'Invalid username or password!' });
        }
    });
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;