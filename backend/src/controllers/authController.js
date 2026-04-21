const bcrypt = require('bcrypt');
const { pool } = require('../utils/pgDb');

// @desc    Register a new user
// @route   POST /api/auth/register
exports.register = async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password are required' });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const client = await pool.connect();
  try {
    // Check email uniqueness
    const emailCheck = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Check username uniqueness
    const usernameCheck = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, created_at AS "createdAt"',
      [email, username, passwordHash]
    );

    return res.status(201).json(result.rows[0]);
  } finally {
    client.release();
  }
};

// @desc    Login
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, email, username, password_hash, created_at AS "createdAt" FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    return res.status(200).json({
      id: user.id,
      email: user.email,
      username: user.username,
      createdAt: user.createdAt,
    });
  } finally {
    client.release();
  }
};

// @desc    Logout
// @route   POST /api/auth/logout
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    return res.status(200).json({ success: true });
  });
};

// @desc    Update profile (username or password)
// @route   PATCH /api/auth/profile
exports.updateProfile = async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;

  const client = await pool.connect();
  try {
    if (username !== undefined) {
      // Update username
      if (!username || !String(username).trim()) {
        return res.status(400).json({ error: 'Username cannot be empty' });
      }
      const trimmedUsername = String(username).trim();

      const usernameCheck = await client.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [trimmedUsername, req.session.userId]
      );
      if (usernameCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      const result = await client.query(
        'UPDATE users SET username = $1 WHERE id = $2 RETURNING id, email, username, created_at AS "createdAt"',
        [trimmedUsername, req.session.userId]
      );
      req.session.username = result.rows[0].username;
      return res.status(200).json(result.rows[0]);
    }

    if (currentPassword !== undefined && newPassword !== undefined) {
      // Update password
      const userResult = await client.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.session.userId]
      );
      const user = userResult.rows[0];
      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.session.userId]);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Provide username or currentPassword + newPassword' });
  } finally {
    client.release();
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
exports.me = async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, email, username, created_at AS "createdAt" FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.status(200).json(result.rows[0]);
  } finally {
    client.release();
  }
};
