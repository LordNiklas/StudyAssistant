const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Initialize PostgreSQL client
const pool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'vectordb',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
});

const SCHEMA_INIT_LOCK_KEY = 42873191;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Connect to PostgreSQL and initialize schema
const connectDB = async () => {
  return new Promise((resolve, reject) => {
    // Set a timeout to prevent hanging indefinitely
    const connectionTimeout = setTimeout(() => {
      reject(new Error('PostgreSQL connection timeout after 10 seconds'));
    }, 10000);

    (async () => {
      let client;
      try {
        // Test connection
        client = await pool.connect();
        console.log('PostgreSQL connected successfully');

        // Prevent concurrent schema initialization across multiple server instances.
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_INIT_LOCK_KEY]);
        
        // Initialize schema
        const fs = require('fs');
        const path = require('path');
        const schemaPath = path.join(__dirname, 'schema.sql');
        
        if (fs.existsSync(schemaPath)) {
          const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
          let schemaInitialized = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await client.query(schemaSQL);
              schemaInitialized = true;
              break;
            } catch (schemaError) {
              const isTransientCatalogError =
                schemaError?.code === 'XX000' &&
                String(schemaError?.message || '').includes('tuple concurrently updated');

              if (!isTransientCatalogError || attempt === 3) {
                throw schemaError;
              }

              console.warn(`Schema init transient error (attempt ${attempt}/3), retrying...`);
              await sleep(250 * attempt);
            }
          }

          if (!schemaInitialized) {
            throw new Error('Failed to initialize schema after retries');
          }
          console.log('PostgreSQL schema initialized successfully');
        } else {
          console.warn('Schema file not found at:', schemaPath);
        }

        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_INIT_LOCK_KEY]);

        // Run the app-level migration that guarantees a default owner for legacy subjects.
        await runUserMigration(pool);

        clearTimeout(connectionTimeout);
        resolve(pool);
      } catch (error) {
        clearTimeout(connectionTimeout);
        console.error('PostgreSQL connection error:', error.message);
        reject(error);
      } finally {
        if (client) {
          client.release();
        }
      }
    })();
  });
};

// Ensures a default user exists and enforces a non-null owner for all subjects.
const runUserMigration = async (dbPool) => {
  const client = await dbPool.connect();
  try {
    // Ensure the timestamp column exists and is always populated.
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP');
    await client.query('ALTER TABLE users ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP');
    await client.query('UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL');
    await client.query('ALTER TABLE users ALTER COLUMN created_at SET NOT NULL');

    // Insert default user if not exists
    const existing = await client.query(
      "SELECT id FROM users WHERE email = 'peter.tester@local'"
    );

    let defaultUserId;
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash('tester123', 10);
      const result = await client.query(
        "INSERT INTO users (email, username, password_hash, created_at) VALUES ('peter.tester@local', 'PeterTester', $1, CURRENT_TIMESTAMP) RETURNING id",
        [passwordHash]
      );
      defaultUserId = result.rows[0].id;
      console.log('[Migration] Default user created:');
      console.log('[Migration]   Email:    peter.tester@local');
      console.log('[Migration]   Username: PeterTester');
      console.log('[Migration]   Password: tester123');
    } else {
      defaultUserId = existing.rows[0].id;
    }

    // Assign all subjects without a user_id to the default user
    await client.query(
      'UPDATE subjects SET user_id = $1 WHERE user_id IS NULL',
      [defaultUserId]
    );

    // Make user_id NOT NULL (idempotent: no-op if already NOT NULL)
    await client.query(
      'ALTER TABLE subjects ALTER COLUMN user_id SET NOT NULL'
    );
  } finally {
    client.release();
  }
};

// Helper function to convert MongoDB ObjectId to string
const objectIdToString = (id) => {
  return id ? id.toString() : null;
};

// Helper function to generate a UUID-like string (to replace MongoDB ObjectIds)
const generateId = () => {
  return 'id_' + Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

module.exports = {
  pool,
  connectDB,
  objectIdToString,
  generateId
};