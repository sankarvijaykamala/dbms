const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.redirect('/login');
    }
};

router.use(requireAdmin);

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

// Update status on every request
router.use((req, res, next) => {
    updateElectionStatus();
    next();
});

// Admin dashboard
router.get('/dashboard', (req, res) => {
    const statsQuery = `
        SELECT 
            (SELECT COUNT(*) FROM elections) as total_elections,
            (SELECT COUNT(*) FROM candidates) as total_candidates,
            (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students,
            (SELECT COUNT(*) FROM elections WHERE status = 'ongoing') as ongoing_elections
    `;
    
    db.query(statsQuery, (err, results) => {
        if (err) {
            console.error(err);
            return res.render('admin/dashboard', {
                user: req.session.user,
                stats: { total_elections: 0, total_candidates: 0, total_students: 0, ongoing_elections: 0 }
            });
        }
        
        res.render('admin/dashboard', {
            user: req.session.user,
            stats: results[0]
        });
    });
});

// Create election page
router.get('/create-election', (req, res) => {
    res.render('admin/create-election', { 
        user: req.session.user,
        error: null,
        success: null 
    });
});

// Create election - FORCE ACTIVE FOR DEMO
router.post('/create-election', (req, res) => {
    const { title, description, start_date, end_date } = req.body;
    
    if (!title) {
        return res.render('admin/create-election', {
            user: req.session.user,
            error: 'Election title is required!',
            success: null
        });
    }
    
    // Set dates - force active for demo
    let startDate = start_date;
    let endDate = end_date;
    
    if (!start_date) {
        startDate = new Date().toISOString().slice(0, 16);
    }
    if (!end_date) {
        const future = new Date();
        future.setDate(future.getDate() + 7);
        endDate = future.toISOString().slice(0, 16);
    }
    
    // FORCE status to ongoing
    const status = 'ongoing';
    
    console.log('🎯 Creating election with FORCED active status');
    
    const query = `
        INSERT INTO elections (title, description, start_date, end_date, created_by, status) 
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.query(query, [title, description, startDate, endDate, req.session.user.id, status], (err, results) => {
        if (err) {
            console.error('❌ Error creating election:', err);
            return res.render('admin/create-election', {
                user: req.session.user,
                error: 'Error creating election!',
                success: null
            });
        }
        
        console.log('✅ Election created successfully with ID:', results.insertId);
        
        res.render('admin/create-election', {
            user: req.session.user,
            error: null,
            success: 'Election created successfully! Status: ACTIVE 🎉'
        });
    });
});

// View all elections
router.get('/elections', (req, res) => {
    const query = `
        SELECT e.*, u.username as created_by_name, 
               (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) as candidate_count,
               (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id) as vote_count
        FROM elections e 
        LEFT JOIN users u ON e.created_by = u.id 
        ORDER BY 
            CASE e.status
                WHEN 'ongoing' THEN 1
                WHEN 'upcoming' THEN 2
                WHEN 'completed' THEN 3
                ELSE 4
            END,
            e.start_date DESC
    `;
    
    db.query(query, (err, elections) => {
        if (err) {
            console.error(err);
            return res.render('admin/elections', {
                user: req.session.user,
                elections: []
            });
        }
        
        // Handle query parameters
        const success = req.query.success;
        const error = req.query.error;
        
        res.render('admin/elections', {
            user: req.session.user,
            elections: elections,
            success: success,
            error: error
        });
    });
});

// DELETE ELECTION - COMPLETE WITH CASCADING
router.post('/delete-election/:id', (req, res) => {
    const electionId = req.params.id;
    
    console.log('🗑️ Deleting election:', electionId);
    
    // Start a transaction to ensure data integrity
    db.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.redirect('/admin/elections?error=transaction_error');
        }
        
        // 1. First delete all votes for this election
        const deleteVotesQuery = 'DELETE FROM votes WHERE election_id = ?';
        db.query(deleteVotesQuery, [electionId], (err, voteResult) => {
            if (err) {
                console.error('Error deleting votes:', err);
                return db.rollback(() => {
                    res.redirect('/admin/elections?error=delete_votes_failed');
                });
            }
            
            console.log('✅ Deleted votes:', voteResult.affectedRows);
            
            // 2. Delete all candidates for this election
            const deleteCandidatesQuery = 'DELETE FROM candidates WHERE election_id = ?';
            db.query(deleteCandidatesQuery, [electionId], (err, candidateResult) => {
                if (err) {
                    console.error('Error deleting candidates:', err);
                    return db.rollback(() => {
                        res.redirect('/admin/elections?error=delete_candidates_failed');
                    });
                }
                
                console.log('✅ Deleted candidates:', candidateResult.affectedRows);
                
                // 3. Finally delete the election itself
                const deleteElectionQuery = 'DELETE FROM elections WHERE id = ?';
                db.query(deleteElectionQuery, [electionId], (err, electionResult) => {
                    if (err) {
                        console.error('Error deleting election:', err);
                        return db.rollback(() => {
                            res.redirect('/admin/elections?error=delete_election_failed');
                        });
                    }
                    
                    console.log('✅ Deleted election:', electionResult.affectedRows);
                    
                    // Commit the transaction
                    db.commit((err) => {
                        if (err) {
                            console.error('Commit error:', err);
                            return db.rollback(() => {
                                res.redirect('/admin/elections?error=commit_error');
                            });
                        }
                        
                        res.redirect('/admin/elections?success=election_deleted');
                    });
                });
            });
        });
    });
});

// MANUAL: Force election to active
router.post('/force-active/:id', (req, res) => {
    const electionId = req.params.id;
    
    const query = 'UPDATE elections SET status = "ongoing" WHERE id = ?';
    db.query(query, [electionId], (err, result) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections?error=update_failed');
        }
        
        res.redirect('/admin/elections?success=active_forced');
    });
});

// MANUAL: Update election status
router.post('/update-election-status/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    const { status } = req.body;
    
    const validStatuses = ['upcoming', 'ongoing', 'completed'];
    if (!validStatuses.includes(status)) {
        return res.redirect('/admin/elections?error=invalid_status');
    }
    
    const query = 'UPDATE elections SET status = ? WHERE id = ?';
    db.query(query, [status, electionId], (err, results) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections?error=update_failed');
        }
        
        res.redirect('/admin/elections?success=status_updated');
    });
});

// FORCE UPDATE ALL ELECTIONS STATUS
router.get('/force-update-all', (req, res) => {
    const updateQuery = `
        UPDATE elections 
        SET status = 
            CASE 
                WHEN NOW() < start_date THEN 'upcoming'
                WHEN NOW() BETWEEN start_date AND end_date THEN 'ongoing'
                ELSE 'completed'
            END
    `;
    
    db.query(updateQuery, (err, result) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections?error=update_failed');
        }
        
        res.redirect('/admin/elections?success=all_updated&affected=' + result.affectedRows);
    });
});

// Manage candidates for an election
router.get('/manage-candidates/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    
    const electionQuery = 'SELECT * FROM elections WHERE id = ?';
    db.query(electionQuery, [electionId], (err, electionResults) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections');
        }
        
        if (electionResults.length === 0) {
            return res.redirect('/admin/elections');
        }
        
        const candidatesQuery = `
            SELECT c.*, u.full_name, u.username, u.student_id 
            FROM candidates c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.election_id = ?
            ORDER BY c.status, c.position
        `;
        
        db.query(candidatesQuery, [electionId], (err, candidates) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin/elections');
            }
            
            res.render('admin/manage-candidates', {
                user: req.session.user,
                election: electionResults[0],
                candidates: candidates
            });
        });
    });
});

// Approve candidate
router.post('/approve-candidate/:candidateId', (req, res) => {
    const candidateId = req.params.candidateId;
    
    const query = 'UPDATE candidates SET status = "approved" WHERE id = ?';
    db.query(query, [candidateId], (err, results) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections');
        }
        
        const getElectionQuery = 'SELECT election_id FROM candidates WHERE id = ?';
        db.query(getElectionQuery, [candidateId], (err, candidateResults) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin/elections');
            }
            
            res.redirect('/admin/manage-candidates/' + candidateResults[0].election_id);
        });
    });
});

// Reject candidate
router.post('/reject-candidate/:candidateId', (req, res) => {
    const candidateId = req.params.candidateId;
    
    const query = 'UPDATE candidates SET status = "rejected" WHERE id = ?';
    db.query(query, [candidateId], (err, results) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections');
        }
        
        const getElectionQuery = 'SELECT election_id FROM candidates WHERE id = ?';
        db.query(getElectionQuery, [candidateId], (err, candidateResults) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin/elections');
            }
            
            res.redirect('/admin/manage-candidates/' + candidateResults[0].election_id);
        });
    });
});

// Delete candidate
router.post('/delete-candidate/:candidateId', (req, res) => {
    const candidateId = req.params.candidateId;
    
    const getElectionQuery = 'SELECT election_id FROM candidates WHERE id = ?';
    db.query(getElectionQuery, [candidateId], (err, candidateResults) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections');
        }
        
        const electionId = candidateResults[0].election_id;
        
        const deleteQuery = 'DELETE FROM candidates WHERE id = ?';
        db.query(deleteQuery, [candidateId], (err, results) => {
            if (err) {
                console.error(err);
                return res.redirect('/admin/elections');
            }
            
            res.redirect('/admin/manage-candidates/' + electionId);
        });
    });
});

// View election results
router.get('/results/:electionId', (req, res) => {
    const electionId = req.params.electionId;
    
    const electionQuery = 'SELECT * FROM elections WHERE id = ?';
    db.query(electionQuery, [electionId], (err, electionResults) => {
        if (err) {
            console.error(err);
            return res.redirect('/admin/elections');
        }
        
        if (electionResults.length === 0) {
            return res.redirect('/admin/elections');
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
                return res.redirect('/admin/elections');
            }
            
            const totalVotesQuery = 'SELECT COUNT(*) as total FROM votes WHERE election_id = ?';
            db.query(totalVotesQuery, [electionId], (err, voteCount) => {
                if (err) {
                    console.error(err);
                    return res.redirect('/admin/elections');
                }
                
                res.render('admin/results', {
                    user: req.session.user,
                    election: election,
                    results: results,
                    totalVotes: voteCount[0].total,
                    canViewResults: canViewResults,
                    currentTime: now,
                    endTime: endDate
                });
            });
        });
    });
});

module.exports = router;