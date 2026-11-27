/* A30: Rate limiters using express-rate-limit.
   Location: moodtide-backend/server/src/ratelimit.js */
import rateLimit from 'express-rate-limit';

/**
 * Auth rate limiter: 10 attempts per 15 minutes per IP on login and register.
 * Returns 429 Too Many Requests with readable JSON.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,                 // 10 attempts per window
  standardHeaders: true,     // Return standard RateLimit-* headers
  legacyHeaders: false,      // Disable X-RateLimit-* headers
  message: {
    error: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  validate: { trustProxy: false },
});

/**
 * Global API rate limiter: 300 requests per 15 minutes per IP overall.
 * Returns 429 Too Many Requests with readable JSON.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,                // 300 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  validate: { trustProxy: false },
});
