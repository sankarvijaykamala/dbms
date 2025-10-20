const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Middleware to check if user is student
const requireStudent = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'student') {
        next();
    } else {
        res.redirect('/login');
    }
};

router.use(requireStudent);

// Student dashboard
router.get('/dashboard', (req, res) => {
    const query = `
        SELECT e.*, 
               (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id AND c.user_id = ?) as is_candidate,
               (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id AND v.voter_id = ?) as has_voted
        FROM elections e 
        WHERE e.status = 'ongoing'
        ORDER BY e.end_date ASC
    `;
    
    db.query(query, [req.session.user.id, req.session.user.id], (err, elections) => {
        if (err) {
            console.error(err);
            return res.render('student/dashboard', {
                user: req.session.user,
                elections: []
            });
        }
        
        res.render('student/dashboard', {
            user: req.session.user,
            elections: elections
        });
    });
});

// View all elections
router.get('/elections', (req, res) => {
    const query = `
        SELECT e.*, 
               (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id AND c.status = 'approved') as candidate_count,
               (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id AND v.voter_id = ?) as has_voted
        FROM elections e 
        WHERE e.status = 'ongoing'
        ORDER BY e.end_date ASC
    `;
    
    db.query(query, [req.session.user.id], (err, elections) => {
        if (err) {
            console.error(err);
            return res.render('student/elections', {
                user: req.session.user,
                elections: []
            });
        }
        
        res.render('student/elections', {
            user: req.session.user,
            elections: elections
        });
    });
});

// Register as candidate - WORKING
router.get('/register-candidate/:id', (req, res) => {
    const electionId = req.params.id;
    
    // Check if election exists
    db.query('SELECT * FROM elections WHERE id = ?', [electionId], (err, electionResults) => {
        if (err || electionResults.length === 0) {
            return res.redirect('/student/elections');
        }
        
        // Check if already registered
        db.query('SELECT * FROM candidates WHERE election_id = ? AND user_id = ?', [electionId, req.session.user.id], (err, candidateResults) => {
            if (err) {
                return res.redirect('/student/elections');
            }
            
            if (candidateResults.length > 0) {
                return res.redirect('/student/elections?error=already_registered');
            }
            
            res.render('student/register-candidate', {
                user: req.session.user,
                election: electionResults[0],
                error: null,
                success: null
            });
        });
    });
});

// Process candidate registration - WORKING
router.post('/register-candidate/:id', (req, res) => {
    const electionId = req.params.id;
    const { candidate_name, position, manifesto } = req.body;
    
    if (!candidate_name || !position) {
        return res.render('student/register-candidate', {
            user: req.session.user,
            election: { id: electionId },
            error: 'Candidate name and position are required!',
            success: null
        });
    }
    
    const query = 'INSERT INTO candidates (election_id, user_id, candidate_name, position, manifesto) VALUES (?, ?, ?, ?, ?)';
    db.query(query, [electionId, req.session.user.id, candidate_name, position, manifesto], (err, results) => {
        if (err) {
            console.error(err);
            return res.render('student/register-candidate', {
                user: req.session.user,
                election: { id: electionId },
                error: 'Error registering as candidate!',
                success: null
            });
        }
        
        res.render('student/register-candidate', {
            user: req.session.user,
            election: { id: electionId },
            error: null,
            success: 'Successfully registered as candidate! Waiting for admin approval.'
        });
    });
});

// Vote in election - WORKING
router.get('/vote/:id', (req, res) => {
    const electionId = req.params.id;
    
    // Get election details
    db.query('SELECT * FROM elections WHERE id = ?', [electionId], (err, electionResults) => {
        if (err || electionResults.length === 0) {
            return res.redirect('/student/elections?error=election_not_found');
        }
        
        const election = electionResults[0];
        
        // Check if already voted
        db.query('SELECT * FROM votes WHERE election_id = ? AND voter_id = ?', [electionId, req.session.user.id], (err, voteResults) => {
            if (err) {
                return res.redirect('/student/elections');
            }
            
            if (voteResults.length > 0) {
                return res.redirect('/student/elections?error=already_voted');
            }
            
            // Get approved candidates
            db.query('SELECT * FROM candidates WHERE election_id = ? AND status = "approved"', [electionId], (err, candidateResults) => {
                if (err || candidateResults.length === 0) {
                    return res.redirect('/student/elections?error=no_candidates');
                }
                
                res.render('student/vote', {
                    user: req.session.user,
                    election: election,
                    candidates: candidateResults
                });
            });
        });
    });
});

// Process vote - WORKING
router.post('/vote/:id', (req, res) => {
    const electionId = req.params.id;
    const { candidate_id } = req.body;
    
    if (!candidate_id) {
        return res.redirect('/student/vote/' + electionId + '?error=no_candidate');
    }
    
    // Check if already voted
    db.query('SELECT * FROM votes WHERE election_id = ? AND voter_id = ?', [electionId, req.session.user.id], (err, voteResults) => {
        if (err) {
            return res.redirect('/student/elections');
        }
        
        if (voteResults.length > 0) {
            return res.redirect('/student/elections?error=already_voted');
        }
        
        // Record vote
        const voteQuery = 'INSERT INTO votes (election_id, voter_id, candidate_id) VALUES (?, ?, ?)';
        db.query(voteQuery, [electionId, req.session.user.id, candidate_id], (err, results) => {
            if (err) {
                console.error(err);
                return res.redirect('/student/elections');
            }
            
            res.redirect('/student/elections?success=voted');
        });
    });
});

// View results - WORKING
router.get('/results/:id', (req, res) => {
    const electionId = req.params.id;
    
    // Get election details
    db.query('SELECT * FROM elections WHERE id = ?', [electionId], (err, electionResults) => {
        if (err || electionResults.length === 0) {
            return res.redirect('/student/elections');
        }
        
        const election = electionResults[0];
        
        // Get results
        const resultsQuery = `
            SELECT c.candidate_name, c.position, COUNT(v.id) as vote_count
            FROM candidates c
            LEFT JOIN votes v ON c.id = v.candidate_id
            WHERE c.election_id = ? AND c.status = 'approved'
            GROUP BY c.id
            ORDER BY vote_count DESC
        `;
        
        db.query(resultsQuery, [electionId], (err, results) => {
            if (err) {
                console.error(err);
                return res.redirect('/student/elections');
            }
            
            res.render('student/results', {
                user: req.session.user,
                election: election,
                results: results || []
            });
        });
    });
});

module.exports = router;