import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import apiRoutes from './routes/api.js';
import { startEpochCron } from './jobs/epochCron.js';
import { startStakeSync } from './services/stake-sync.js';
import { rateLimit } from './middleware/auth.js';
import { initDatabase, db } from './db/index.js';
import { schema, schemaPostgres } from './db/schema.js';

const app = express();

// Trust proxy for proper IP detection and HTTPS behind reverse proxies (Render, Railway, etc.)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.devnet.solana.com", "https://api.mainnet-beta.solana.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for wallet adapters
}));

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN?.replace(/\/$/, '');
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.) in development only
    if (!origin && !isProduction) {
      return callback(null, true);
    }

    // In production, require CORS_ORIGIN to be set
    if (isProduction && !corsOrigin) {
      console.warn('[SECURITY] CORS_ORIGIN not set in production, blocking cross-origin requests');
      return callback(null, false);
    }

    // Check if origin matches configured CORS_ORIGIN
    if (corsOrigin) {
      const allowedOrigins = corsOrigin.split(',').map(o => o.trim());
      if (allowedOrigins.includes(origin || '') || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(null, false);
    }

    // Development fallback: allow all
    callback(null, true);
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-debug-key'],
  credentials: true,
}));

app.use(express.json());
app.use(rateLimit(300, 60000)); // 300 requests per minute

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', apiRoutes);

// Error handling
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
async function start() {
  // Initialize database
  await initDatabase();

  // Run migrations
  const isPostgres = config.databaseUrl.startsWith('postgresql:') ||
                     config.databaseUrl.startsWith('postgres:');
  const schemaToUse = isPostgres ? schemaPostgres : schema;

  console.log(`[DB] Running migrations (${isPostgres ? 'PostgreSQL' : 'SQLite'})...`);
  await db.exec(schemaToUse);
  console.log('[DB] Migrations complete');

  const server = app.listen(config.port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🌾 GREED FARM - Staking Game Backend                   ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Server running on port ${config.port.toString().padEnd(29)}║
║   Epoch duration: ${(config.epochDuration + ' seconds').padEnd(36)}║
║   Warmup period: ${(config.warmupDuration + ' seconds').padEnd(37)}║
║   Quorum: 7% (1-100) → 14% (101-250) → 21% (251-500)     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);

    // Start epoch cron job
    startEpochCron();

    // Start stake sync job (syncs on-chain stakes every 60s)
    startStakeSync(60000);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('\n[SERVER] Received SIGTERM, shutting down gracefully...');
    server.close(() => {
      console.log('[SERVER] Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('\n[SERVER] Received SIGINT, shutting down gracefully...');
    server.close(() => {
      console.log('[SERVER] Server closed');
      process.exit(0);
    });
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
