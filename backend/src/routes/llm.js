const express = require('express');
const { queryLlm } = require('../controllers/llmController');

const router = express.Router();

router.route('/query').post(queryLlm);

module.exports = router;
