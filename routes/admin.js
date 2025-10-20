
       // routes/admin.js

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        // Handle case where user is not logged in or is not admin
        req.session.destroy(() => {
            res.redirect('/login');
        });
    }
};

router.use(requireAdmin);

// ADMIN DASHBOARD (Corrected to render EJS and fetch data)
router.get('/dashboard', (req, res) => {
    const studentCountQuery = 'SELECT COUNT(*) as count FROM users WHERE role = "student"';
    const electionCountQuery = 'SELECT COUNT(*) as count FROM elections';
    const candidateCountQuery = 'SELECT COUNT(*) as count FROM candidates';
    const voteCountQuery = 'SELECT COUNT(*) as count FROM votes';
    const recentElectionsQuery = 'SELECT * FROM elections ORDER BY created_at DESC LIMIT 5';

    db.query(studentCountQuery, (err1, studentResults) => {
        db.query(electionCountQuery, (err2, electionResults) => {
            db.query(candidateCountQuery, (err3, candidateResults) => {
                db.query(voteCountQuery, (err4, voteResults) => {
                    db.query(recentElectionsQuery, (err5, elections) => {
                        const counts = {
                            student_count: studentResults[0].count,
                            election_count: electionResults[0].count,
                            candidate_count: candidateResults[0].count,
                            vote_count: voteResults[0].count,
                        };
                        
                        res.render('admin/dashboard', {
                            user: req.session.user,
                            counts: counts,
                            elections: elections || []
                        });
                    });
                });
            });
        });
    });
});

// CANDIDATE MANAGEMENT (FIXED: Now uses res.render to display candidate.ejs)
router.get('/candidates', (req, res) => {
    const query = `
        SELECT c.*, u.college_id, u.full_name as student_name, e.title as election_title
        FROM candidates c
        JOIN users u ON c.user_id = u.id  
        JOIN elections e ON c.election_id = e.id
        ORDER BY c.created_at DESC
    `;
    
    db.query(query, (err, candidates) => {
        if (err) {
            console.error('Database error fetching candidates:', err);
            return res.send(`<h1>Error</h1><p>Database error: ${err.message}</p><a href="/admin/dashboard">Back to Dashboard</a>`);
        }
        
        // Use res.render and pass the data to candidate.ejs
        res.render('admin/candidate', { 
            user: req.session.user,
            candidates: candidates
        });
    });
});

// APPROVE CANDIDATE - SIMPLE VERSION (Functional - redirects to the now-fixed /candidates route)
router.get('/approve-candidate/:id', (req, res) => {
    const candidateId = req.params.id;
    console.log('APPROVING CANDIDATE:', candidateId);
    
    const query = 'UPDATE candidates SET status = "approved" WHERE id = ?';
    
    db.query(query, [candidateId], (err, results) => {
        if (err) {
            console.error('Error approving candidate:', err);
            res.send(`<h1>Error</h1><p>${err.message}</p><a href="/admin/candidates">Back</a>`);
        } else {
            console.log('SUCCESS: Candidate approved');
            res.redirect('/admin/candidates');
        }
    });
});

// REJECT CANDIDATE - SIMPLE VERSION (Functional - redirects to the now-fixed /candidates route)
router.get('/reject-candidate/:id', (req, res) => {
    const candidateId = req.params.id;
    console.log('REJECTING CANDIDATE:', candidateId);
    
    const query = 'UPDATE candidates SET status = "rejected" WHERE id = ?';
    
    db.query(query, [candidateId], (err, results) => {
        if (err) {
            console.error('Error rejecting candidate:', err);
            res.send(`<h1>Error</h1><p>${err.message}</p><a href="/admin/candidates">Back</a>`);
        } else {
            console.log('SUCCESS: Candidate rejected');
            res.redirect('/admin/candidates');
        }
    });
});

// MANAGE ELECTIONS (Corrected to render elections.ejs)
router.get('/elections', (req, res) => {
    db.query('SELECT * FROM elections ORDER BY created_at DESC', (err, elections) => {
        if (err) {
            console.error('Database error fetching elections:', err);
            return res.send(`<h1>Error</h1><p>${err.message}</p>`);
        }
        
        // Use res.render and pass the data to elections.ejs
        res.render('admin/elections', {
            user: req.session.user,
            elections: elections
        });
    });
});

// RENDER CREATE ELECTION PAGE (New route to display the form)
router.get('/create-election', (req, res) => {
    res.render('admin/create-election', {
        user: req.session.user,
        error: null,
        success: null
    });
});

// PROCESS CREATE ELECTION (New route to handle form submission)
router.post('/create-election', (req, res) => {
    const { title, description, start_date, end_date } = req.body;
    
    if (!title || !start_date || !end_date) {
        return res.render('admin/create-election', { 
            user: req.session.user,
            error: 'Title, start date, and end date are required!',
            success: null 
        });
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    const now = new Date();
    
    let status = 'upcoming';
    if (start <= now && end > now) {
        status = 'ongoing';
    } else if (end <= now) {
        status = 'completed';
    }
    
    const query = 'INSERT INTO elections (title, description, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)';
    db.query(query, [title, description, start_date, end_date, status], (err, result) => {
        if (err) {
            console.error(err);
            return res.render('admin/create-election', { 
                user: req.session.user,
                error: 'Error creating election: ' + err.message,
                success: null 
            });
        }
        
        // Redirect to elections list on success
        res.redirect('/admin/elections');
    });
});


// VIEW RESULTS (Corrected to render results.ejs and calculate total votes)
router.get('/results/:id', (req, res) => {
    const electionId = req.params.id;
    
    // Get election details and vote results in one query bundle
    const electionQuery = 'SELECT * FROM elections WHERE id = ?';
    const resultsQuery = `
        SELECT c.candidate_name, c.position, COUNT(v.id) as vote_count
        FROM candidates c
        LEFT JOIN votes v ON c.id = v.candidate_id
        WHERE c.election_id = ? AND c.status = 'approved'
        GROUP BY c.id, c.candidate_name, c.position
        ORDER BY vote_count DESC
    `;
    
    db.query(electionQuery, [electionId], (err, electionResults) => {
        if (err || electionResults.length === 0) {
            return res.redirect('/admin/elections'); // Or show an error
        }
        
        const election = electionResults[0];
        
        db.query(resultsQuery, [electionId], (err, results) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin/elections');
            }
            
            const totalVotes = results.reduce((sum, candidate) => sum + candidate.vote_count, 0);

            res.render('admin/results', {
                user: req.session.user,
                election: election,
                results: results || [],
                totalVotes: totalVotes
            });
        });
    });
});

// MANAGE STUDENTS (New route to display student.ejs)
router.get('/students', (req, res) => {
    const query = 'SELECT * FROM users WHERE role = "student" ORDER BY created_at DESC';
    
    db.query(query, (err, students) => {
        if (err) {
            console.error('Database error fetching students:', err);
            return res.send(`<h1>Error</h1><p>Database error: ${err.message}</p>`);
        }
        
        res.render('admin/student', {
            user: req.session.user,
            students: students
        });
    });
});

// COMPLETE ELECTION (New route to set status to 'completed')
router.get('/complete-election/:id', (req, res) => {
    const electionId = req.params.id;
    const query = 'UPDATE elections SET status = "completed" WHERE id = ?';
    
    db.query(query, [electionId], (err) => {
        if (err) {
            console.error('Error completing election:', err);
        }
        res.redirect('/admin/elections');
    });
});

// DELETE ELECTION (New route for deletion)
router.get('/delete-election/:id', (req, res) => {
    const electionId = req.params.id;
    // Transaction needed for a proper app, but for simplicity:
    db.query('DELETE FROM votes WHERE election_id = ?', [electionId], (err) => {
        db.query('DELETE FROM candidates WHERE election_id = ?', [electionId], (err) => {
            db.query('DELETE FROM elections WHERE id = ?', [electionId], (err) => {
                if (err) console.error('Error deleting election:', err);
                res.redirect('/admin/elections');
            });
        });
    });
});


module.exports = router;