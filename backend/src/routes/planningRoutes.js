const express = require('express');
const router = express.Router();
const { getEffortProbability } = require('../controllers/assessmentController');

// Route for /api/planning
router.post('/effort-probability/:subjectId', getEffortProbability);

module.exports = router;
