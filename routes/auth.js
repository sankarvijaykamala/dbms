// routes/auth.js

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Login page
router.get('/login', (req, res) => {
    res.render('auth/login', { error: null, success: null });
});

// Registration page
router.get('/register', (req, res) => {
    res.render('auth/register', { error: null, success: null });
});

// Registration process
router.post('/register', (req, res) => {
    const { college_id, password, confirm_password, full_name } = req.body;
    
    if (!college_id || !password || !confirm_password || !full_name) {
        return res.render('auth/register', { 
            error: 'All fields are required!',
            success: null 
        });
    }
    
    if (password !== confirm_password) {
        return res.render('auth/register', { 
            error: 'Passwords do not match!',
            success: null 
        });
    }
    
    // Check if college ID already exists
    const checkQuery = 'SELECT * FROM users WHERE college_id = ?';
    db.query(checkQuery, [college_id], (err, results) => {
        if (err) {
            return res.render('auth/register', { 
                error: 'Server error!',
                success: null 
            });
        }
        
        if (results.length > 0) {
            return res.render('auth/register', { 
                error: 'College ID already registered!',
                success: null 
            });
        }
        
        // Create new student account
        const insertQuery = 'INSERT INTO users (college_id, password, full_name, role) VALUES (?, ?, ?, "student")';
        db.query(insertQuery, [college_id, password, full_name], (err, result) => {
            if (err) {
                return res.render('auth/register', { 
                    error: 'Error creating account!',
                    success: null 
                });
            }
            
            res.render('auth/register', { 
                error: null,
                success: 'Registration successful! You can now login.'
            });
        });
    });
});

// Login process
router.post('/login', (req, res) => {
    const { college_id, password } = req.body;
    
    if (!college_id || !password) {
        return res.render('auth/login', { 
            error: 'College ID and password are required!',
            success: null 
        });
    }

    // --- Special handling for hardcoded admin demo login ---
    // In a real application, the admin user must exist in the DB.
    // If the admin user is not in the DB, let's create a minimal session for testing.
    if (college_id === 'admin' && password === 'admin') {
        // Fallback for demo mode if admin is not in the DB
        req.session.user = {
            id: 0, // Mock ID
            college_id: 'admin',
            role: 'admin',
            full_name: 'System Admin' // Default admin name
        };
        return res.redirect('/admin/dashboard');
    }
    // --------------------------------------------------------
    
    const query = 'SELECT * FROM users WHERE college_id = ? AND password = ?';
    db.query(query, [college_id, password], (err, results) => {
        if (err) {
            return res.render('auth/login', { 
                error: 'Server error!',
                success: null 
            });
        }
        
        if (results.length > 0) {
            const user = results[0];
            req.session.user = {
                id: user.id,
                college_id: user.college_id,
                role: user.role,
                full_name: user.full_name
            };
            
            if (user.role === 'admin') {
                res.redirect('/admin/dashboard');
            } else {
                res.redirect('/student/dashboard');
            }
        } else {
            res.render('auth/login', { 
                error: 'Invalid College ID or password!',
                success: null 
            });
        }
    });
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

module.exports = router;