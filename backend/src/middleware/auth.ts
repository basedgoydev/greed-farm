import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { verifySignature } from '../utils/solana.js';

export interface AuthRequest extends Request {
  wallet?: string;
}

// Middleware to verify wallet signature for protected routes
export function requireSignature(req: AuthRequest, res: Response, next: NextFunction): void {
  const { wallet, signature, message } = req.body;

  if (!wallet || !signature || !message) {
    res.status(401).json({
      error: 'Missing authentication parameters'
    });
    return;
  }

  // Verify the message was signed by the wallet
  if (!verifySignature(message, signature, wallet)) {
    res.status(401).json({
      error: 'Invalid signature'
    });
    return;
  }

  // Verify message timestamp (prevent replay attacks)
  try {
    const parts = message.split(':');
    const timestamp = parseInt(parts[parts.length - 1]);
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (isNaN(timestamp) || now - timestamp > maxAge) {
      res.status(401).json({
        error: 'Message expired'
      });
      return;
    }
  } catch {
    res.status(401).json({
      error: 'Invalid message format'
    });
    return;
  }

  req.wallet = wallet;
  next();
}

// Generate a JWT token for a wallet (optional, for session management)
export function generateToken(wallet: string): string {
  return jwt.sign({ wallet }, config.jwtSecret, { expiresIn: '24h' });
}

// Verify JWT token (optional, for session management)
export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Missing authorization header'
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { wallet: string };
    req.wallet = decoded.wallet;
    next();
  } catch {
    res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
}

// Rate limiting by wallet/IP
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_CACHE_SIZE = 50000;

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts) {
    if (now > record.resetAt) {
      requestCounts.delete(key);
    }
  }
}, 60000);

export function rateLimit(maxRequests: number = 60, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const wallet = req.body?.wallet || req.params?.wallet || req.ip || 'unknown';
    const now = Date.now();

    let record = requestCounts.get(wallet);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };

      // Prevent memory exhaustion
      if (requestCounts.size >= MAX_CACHE_SIZE) {
        // Delete oldest entries
        const toDelete = Math.floor(MAX_CACHE_SIZE / 10);
        let deleted = 0;
        for (const key of requestCounts.keys()) {
          if (deleted >= toDelete) break;
          requestCounts.delete(key);
          deleted++;
        }
      }

      requestCounts.set(wallet, record);
    }

    record.count++;

    if (record.count > maxRequests) {
      res.status(429).json({
        error: 'Too many requests, please try again later',
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
      return;
    }

    next();
  };
}

// Stricter rate limit for sensitive endpoints (claims, greed, etc.)
export function strictRateLimit(maxRequests: number = 10, windowMs: number = 60000) {
  return rateLimit(maxRequests, windowMs);
}
