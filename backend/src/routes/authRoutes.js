const express = require('express');
const router = express.Router();
const { register, login, logout, me, updateProfile } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/logout
router.post('/logout', logout);

// GET /api/auth/me
router.get('/me', me);

// PATCH /api/auth/profile
router.patch('/profile', requireAuth, updateProfile);

module.exports = router;
