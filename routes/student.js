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

// Function to update election status automatically
const updateElectionStatus = () => {
    const updateQuery = `
        UPDATE elections 
        SET status = 'ongoing' 
        WHERE start_date <= NOW() AND end_date >= NOW() AND status != 'ongoing'
    `;
    
    db.query(updateQuery, (err, result) => {
        if (err) {
            console.error('Error updating election status:', err);
        }
    });
};

// Update status on every student request
router.use((req, res, next) => {
    updateElectionStatus();
    next();
});

// Student dashboard
router.get('/dashboard', (req, res) => {
    const query = `
        SELECT e.*, 
               (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id AND c.user_id = ?) as is_candidate,
               (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id AND v.voter_id = ?) as has_voted
        FROM elections e 
        WHERE e.status IN ('ongoing', 'upcoming', 'completed')
        ORDER BY 
            CASE 
                WHEN e.status = 'ongoing' THEN 1
                WHEN e.status = 'upcoming' THEN 2
                WHEN e.status = 'completed' THEN 3
            END,
            e.start_date DESC
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

// View elections to vote
router.get('/elections', (req, res) => {
    const query = `
        SELECT e.*, 
               (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id AND c.status = 'approved') as candidate_count,
               (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id AND v.voter_id = ?) as has_voted
        FROM elections e 
        WHERE e.status IN ('upcoming', 'ongoing', 'completed')
        ORDER BY 
            CASE 
                WHEN e.status = 'ongoing' THEN 1
                WHEN e.status = 'upcoming' THEN 2
                WHEN e.status = 'completed' THEN 3
            END,
            e.start_date DESC
    `;
    
    db.query(query, [req.session.user.id], (err, elections) => {
        if (err) {
            console.error(err);
            return res.render('student/elections', {
                user: req.session.user,
                elections: []
            });
        }
        
        const success = req.query.success;
        const error = req.query.error;
        
        res.render('student/elections', {
            user: req.session.user,
            elections: elections,
            success: success,
            error: error
        });
    });
});

// Register as candidate
router.get('/register-candidate/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    
    const electionCheckQuery = 'SELECT * FROM elections WHERE id = ? AND status IN ("upcoming", "ongoing")';
    db.query(electionCheckQuery, [electionId], (err, electionResults) => {
        if (err) {
            console.error(err);
            return res.redirect('/student/dashboard');
        }
        
        if (electionResults.length === 0) {
            return res.redirect('/student/dashboard?error=election_ended');
        }
        
        const checkQuery = 'SELECT * FROM candidates WHERE election_id = ? AND user_id = ?';
        db.query(checkQuery, [electionId, req.session.user.id], (err, results) => {
            if (err) {
                console.error(err);
                return res.redirect('/student/dashboard');
            }
            
            if (results.length > 0) {
                return res.redirect('/student/dashboard?error=already_registered');
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

// Process candidate registration
router.post('/register-candidate/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    const { position, manifesto } = req.body;
    
    if (!position) {
        return res.render('student/register-candidate', {
            user: req.session.user,
            election: { id: electionId },
            error: 'Please enter the position you are running for!',
            success: null
        });
    }
    
    const query = 'INSERT INTO candidates (user_id, election_id, position, manifesto, status) VALUES (?, ?, ?, ?, "pending")';
    db.query(query, [req.session.user.id, electionId, position, manifesto], (err, results) => {
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

// Vote in election - SIMPLIFIED VERSION
router.get('/vote/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    console.log('VOTE PAGE: Loading vote page for election:', electionId);
    
    // First, check if election exists
    const electionQuery = 'SELECT * FROM elections WHERE id = ?';
    db.query(electionQuery, [electionId], (err, electionResults) => {
        if (err) {
            console.error('Database error:', err);
            return res.redirect('/student/elections?error=server_error');
        }
        
        if (electionResults.length === 0) {
            console.log('Election not found:', electionId);
            return res.redirect('/student/elections?error=election_not_found');
        }
        
        const election = electionResults[0];
        console.log('Election found:', election.title, 'Status:', election.status);
        
        // Check if election is active
        if (election.status !== 'ongoing') {
            console.log('Election not active. Status:', election.status);
            return res.redirect('/student/elections?error=election_not_active');
        }
        
        // Check if student already voted
        const voteCheckQuery = 'SELECT * FROM votes WHERE election_id = ? AND voter_id = ?';
        db.query(voteCheckQuery, [electionId, req.session.user.id], (err, voteResults) => {
            if (err) {
                console.error('Vote check error:', err);
                return res.redirect('/student/elections?error=server_error');
            }
            
            if (voteResults.length > 0) {
                console.log('Student already voted');
                return res.redirect('/student/elections?error=already_voted');
            }
            
            // Get approved candidates for this election
            const candidatesQuery = `
                SELECT c.id as candidate_id, u.full_name, c.position, c.manifesto
                FROM candidates c
                JOIN users u ON c.user_id = u.id
                WHERE c.election_id = ? AND c.status = 'approved'
            `;
            
            db.query(candidatesQuery, [electionId], (err, candidates) => {
                if (err) {
                    console.error('Candidates query error:', err);
                    return res.redirect('/student/elections?error=server_error');
                }
                
                console.log('Found candidates:', candidates.length);
                
                if (candidates.length === 0) {
                    console.log('No approved candidates');
                    return res.redirect('/student/elections?error=no_candidates');
                }
                
                // SUCCESS: Render voting page
                console.log('Rendering voting page with', candidates.length, 'candidates');
                res.render('student/vote', {
                    user: req.session.user,
                    election: election,
                    candidates: candidates
                });
            });
        });
    });
});

// Process vote
router.post('/vote/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    const { candidate_id } = req.body;
    
    console.log('Processing vote for election:', electionId, 'Candidate:', candidate_id);
    
    if (!candidate_id) {
        return res.redirect('/student/vote/' + electionId + '?error=no_candidate_selected');
    }
    
    // Check if election is still active
    const electionCheckQuery = 'SELECT * FROM elections WHERE id = ? AND status = "ongoing"';
    db.query(electionCheckQuery, [electionId], (err, electionResults) => {
        if (err) {
            console.error(err);
            return res.redirect('/student/elections');
        }
        
        if (electionResults.length === 0) {
            return res.redirect('/student/elections?error=election_ended');
        }
    
        // Check if already voted
        const voteCheckQuery = 'SELECT * FROM votes WHERE election_id = ? AND voter_id = ?';
        db.query(voteCheckQuery, [electionId, req.session.user.id], (err, voteResults) => {
            if (err) {
                console.error(err);
                return res.redirect('/student/elections');
            }
            
            if (voteResults.length > 0) {
                return res.redirect('/student/elections?error=already_voted');
            }
            
            // Record the vote
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
});

// View results
router.get('/results/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    
    const electionQuery = 'SELECT * FROM elections WHERE id = ?';
    db.query(electionQuery, [electionId], (err, electionResults) => {
        if (err) {
            console.error(err);
            return res.redirect('/student/elections');
        }
        
        if (electionResults.length === 0) {
            return res.redirect('/student/elections');
        }
        
        const election = electionResults[0];
        const now = new Date();
        const endDate = new Date(election.end_date);
        
        const canViewResults = now > endDate || election.status === 'completed';
        
        const resultsQuery = `
            SELECT c.id, u.full_name, c.position, COUNT(v.id) as votes
            FROM candidates c
            JOIN users u ON c.user_id = u.id
            LEFT JOIN votes v ON c.id = v.candidate_id
            WHERE c.election_id = ? AND c.status = 'approved'
            GROUP BY c.id
            ORDER BY votes DESC
        `;
        
        db.query(resultsQuery, [electionId], (err, results) => {
            if (err) {
                console.error(err);
                return res.redirect('/student/elections');
            }
            
            res.render('student/results', {
                user: req.session.user,
                election: election,
                results: results,
                canViewResults: canViewResults,
                currentTime: now,
                endTime: endDate
            });
        });
    });
});

module.exports = router;