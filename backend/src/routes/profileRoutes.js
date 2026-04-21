const express = require('express');
const router = express.Router();
const { getCognitiveProfile } = require('../controllers/assessmentController');

// Read-only cognitive profile for current authenticated user
router.get('/cognitive', getCognitiveProfile);

module.exports = router;
