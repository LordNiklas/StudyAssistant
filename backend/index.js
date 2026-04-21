const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { connectDB, pool } = require('./src/utils/pgDb');
const { initVectorDb, regenerateEmbeddings } = require('./src/utils/vectorDb');

// Load environment variables
dotenv.config();
console.log('Environment variables loaded');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
console.log(`Server will run on port ${PORT}`);

// Create uploads directory if it doesn't exist
const fs = require('fs');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log('Uploads directory created');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In local Docker over HTTP, secure cookies must be disabled.
// Enable secure cookies explicitly via SESSION_COOKIE_SECURE=true (recommended behind HTTPS).
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === 'true';
if (SESSION_COOKIE_SECURE) {
  app.set('trust proxy', 1);
}

// Session middleware
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: SESSION_COOKIE_SECURE
  }
}));

// Serve the built React app from frontend/dist
// Run `npm run build` inside the frontend/ directory to generate this folder.
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Simple route to check if server is running
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Set up API routes immediately
console.log('Setting up API routes...');

// Add error handling middleware for database-related routes
const databaseErrorHandler = (req, res, next) => {
  if (!global.pgConnected) {
    // Get database connection details for debugging
    const dbConfig = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'vectordb',
      user: process.env.POSTGRES_USER || 'postgres'
    };
    
    // Get last connection error if available
    const lastError = global.pgConnectionError ? {
      message: global.pgConnectionError.message,
      code: global.pgConnectionError.code,
      detail: global.pgConnectionError.detail
    } : null;
    
    return res.status(503).json({
      success: false,
      error: 'Database service unavailable. Please start PostgreSQL and restart the application.',
      debug: {
        connectionConfig: dbConfig,
        lastConnectionError: lastError,
        connectionAttempted: global.pgConnectionAttempted || false,
        timestamp: new Date().toISOString()
      }
    });
  }
  next();
};

const vectorDbErrorHandler = (req, res, next) => {
  if (!global.vectorDbInitialized) {
    return res.status(503).json({
      success: false,
      error: 'Vector database service unavailable. Please make sure PostgreSQL with pgvector is running and restart the application.'
    });
  }
  next();
};

const { requireAuth } = require('./src/middleware/auth');

// Auth routes (no requireAuth guard)
app.use('/api/auth', databaseErrorHandler, require('./src/routes/authRoutes'));

// API Routes with error handling
app.use('/api/subjects', databaseErrorHandler, requireAuth, require('./src/routes/subjectRoutes'));
app.use('/api/documents', [databaseErrorHandler, vectorDbErrorHandler], requireAuth, require('./src/routes/documentRoutes'));
app.use('/api/llm', [databaseErrorHandler, vectorDbErrorHandler], requireAuth, require('./src/routes/llm'));
app.use('/api/assessment', [databaseErrorHandler, vectorDbErrorHandler], requireAuth, require('./src/routes/assessmentRoutes'));
app.use('/api/planning', databaseErrorHandler, requireAuth, require('./src/routes/planningRoutes'));
app.use('/api/explain', databaseErrorHandler, requireAuth, require('./src/routes/explainRoutes'));
app.use('/api/profile', databaseErrorHandler, requireAuth, require('./src/routes/profileRoutes'));

// Serve the React app's index.html for all non-API routes (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Initialize global connection status and error tracking
global.pgConnected = false;
global.vectorDbInitialized = false;
global.pgConnectionError = null;
global.pgConnectionAttempted = false;

// Connect to database before starting server
const initializeDatabase = async () => {
  try {
    // Try to connect to PostgreSQL
    console.log('Attempting to connect to PostgreSQL...');
    global.pgConnectionAttempted = true;
    
    try {
      await connectDB();
      console.log('PostgreSQL connected successfully');
      global.pgConnected = true;
      global.pgConnectionError = null; // Clear any previous errors
    } catch (pgError) {
      global.pgConnectionError = pgError;
      throw pgError; // Re-throw to be caught by the outer try/catch
    }
    
    // After PostgreSQL is connected, try to initialize vector database
    console.log('Attempting to initialize vector database...');
    await initVectorDb();
    console.log('Vector database initialized successfully');
    global.vectorDbInitialized = true;

    // Optional migration: regenerate embeddings only when explicitly requested
    if (process.env.REGENERATE_EMBEDDINGS_ON_STARTUP === 'true') {
      console.log('[MIGRATION] REGENERATE_EMBEDDINGS_ON_STARTUP=true, regenerating embeddings...');
      await regenerateEmbeddings();
    }

    console.log('Application fully initialized and ready with all services');
  } catch (err) {
    console.error('Error during application initialization:', err);
    console.error('==========================================================');
    console.error('IMPORTANT: Some services are not available:');
    
    if (!global.pgConnected) {
      console.error('- PostgreSQL is not connected. Database operations will not work.');
      console.error('  Please make sure PostgreSQL is running and properly configured');
      console.error('  Connection details:');
      console.error(`    Host: ${process.env.POSTGRES_HOST || 'localhost'}`);
      console.error(`    Port: ${process.env.POSTGRES_PORT || 5432}`);
      console.error(`    Database: ${process.env.POSTGRES_DB || 'vectordb'}`);
      console.error(`    User: ${process.env.POSTGRES_USER || 'postgres'}`);
      console.error(`  Error: ${err.message}`);
    }
    
    if (global.pgConnected && !global.vectorDbInitialized) {
      console.error('- Vector database is not initialized. Vector search will not work.');
      console.error('  Please make sure PostgreSQL with pgvector extension is properly configured');
    }
    
    console.error('==========================================================');
    console.error('The application will continue to run with limited functionality.');
    console.error('Start the required services and restart the application for full functionality.');
  }
};

// Start the server with error handling
const startServer = async (port) => {
  // Initialize database connections first
  await initializeDatabase();
  
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Application started with basic functionality');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
      
      // Try with a different port if the original port is in use
      if (port === PORT) {
        const alternativePort = parseInt(port) + 1;
        console.log(`Attempting to use alternative port: ${alternativePort}`);
        startServer(alternativePort);
      } else {
        console.error('Could not start server. Please ensure no other application is using the required ports or specify a different port in the .env file.');
        process.exit(1);
      }
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
};

// Start the server
startServer(PORT);
