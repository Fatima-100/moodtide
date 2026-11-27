/* A30: Zod request validation schemas and validate middleware.
   Location: moodtide-backend/server/src/schemas.js */
import { z } from 'zod';
import { HttpError } from './util.js';

export const registerSchema = z.object({
  username: z.string().trim().min(1, 'username is required').max(50, 'username cannot exceed 50 characters'),
  email: z.string().trim().email('Invalid email address').max(255, 'email cannot exceed 255 characters'),
  password: z.string().min(6, 'password must be at least 6 characters long'),
  region: z.enum(['all', 'pakistani', 'punjabi', 'asian', 'indian', 'korean', 'japanese', 'international']).optional(),
  tz: z.string().max(64).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'password is required'),
  tz: z.string().max(64).optional(),
});

export const preferencesSchema = z.object({
  region: z.enum(['all', 'pakistani', 'punjabi', 'asian', 'indian', 'korean', 'japanese', 'international']).optional(),
  tz: z.string().max(64).optional(),
}).refine((data) => data.region !== undefined || data.tz !== undefined, {
  message: 'Must provide either region or tz',
});

export const checkinSchema = z.object({
  mood: z.enum(['happy', 'calm', 'sad', 'energetic', 'stressed'], {
    errorMap: () => ({ message: 'mood must be one of happy, calm, sad, energetic, stressed' }),
  }),
  energy: z.number().int('energy must be an integer').min(1, 'energy must be between 1 and 5').max(5, 'energy must be between 1 and 5').optional(),
});

export const moodCorrectSchema = z.object({
  mood: z.enum(['happy', 'calm', 'sad', 'energetic', 'stressed'], {
    errorMap: () => ({ message: 'mood must be one of happy, calm, sad, energetic, stressed' }),
  }),
});

export const playSchema = z.object({
  songId: z.string().min(1, 'songId required'),
  completed: z.boolean().optional(),
  listenedSec: z.number().nonnegative().optional(),
  source: z.string().max(50).optional(),
  signal: z.enum(['play', 'skip', 'complete', 'replay', 'add_to_playlist']).optional(),
});

export const ratingSchema = z.object({
  songId: z.string().min(1, 'songId is required'),
  stars: z.number().int('stars must be an integer').min(1, 'stars must be between 1 and 5').max(5, 'stars must be between 1 and 5'),
  suggestionId: z.string().nullable().optional(),
});

export const playlistCreateSchema = z.object({
  name: z.string().trim().min(1, 'name required').max(100, 'name must be 100 characters or fewer'),
  description: z.string().max(500, 'description must be 500 characters or fewer').optional().default(''),
});

export const playlistAddSongSchema = z.object({
  songId: z.string().min(1, 'songId required'),
});

export const reportSchema = z.object({
  songId: z.string().min(1, 'songId is required'),
  reason: z.enum(['cannot_play', 'wrong_info', 'copyright', 'inappropriate', 'duplicate', 'other']),
  note: z.string().max(1000).optional().default(''),
});

export const feedbackSchema = z.object({
  page: z.string().trim().min(1, 'page is required').max(100, 'page must be 100 characters or fewer'),
  rating: z.number().int('rating must be an integer').min(1, 'rating must be between 1 and 5').max(5, 'rating must be between 1 and 5'),
  text: z.string().max(2000, 'text must be 2000 characters or fewer').optional().nullable(),
});

export const checkoutSchema = z.object({
  plan_id: z.string().min(1, 'plan_id is required'),
  card_number: z.string().min(1, 'card_number is required'),
  expiry: z.string().min(1, 'expiry is required'),
  cvc: z.string().min(1, 'cvc is required'),
});

// A32/A33: creators and uploads
export const LICENSES = ['CC0', 'CC BY', 'CC BY-SA', 'CC BY-NC', 'CC BY-NC-SA'];
export const AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };   // type -> file extension
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export const creatorRegisterSchema = z.object({
  display_name: z.string().trim().min(1, 'display_name is required').max(100, 'display_name must be 100 characters or fewer'),
  bio: z.string().trim().max(1000, 'bio must be 1000 characters or fewer').optional().default(''),
});

export const uploadRequestSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(200, 'title must be 200 characters or fewer'),
  genre_id: z.string().trim().min(1, 'genre_id is required').max(100),
  license: z.enum(LICENSES, { error: `license must be one of ${LICENSES.join(', ')}` }),
  consent: z.literal(true, { error: 'consent must be true: the creator has to accept the consent text' }),
  content_type: z.enum(Object.keys(AUDIO_TYPES), { error: 'content_type must be audio/mpeg or audio/aac' }).default('audio/mpeg'),
  size_bytes: z.number().int('size_bytes must be a whole number of bytes')
    .min(1, 'size_bytes must be at least 1 byte')
    .max(MAX_UPLOAD_BYTES, 'File must be at most 15 MB')
    .optional(),
});

/**
 * Middleware factory to validate req.body with a Zod schema.
 * Replaces req.body with parsed/sanitized data or responds with readable 400.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      const message = issue ? `${issue.path.length ? issue.path.join('.') + ': ' : ''}${issue.message}` : 'Validation error';
      return res.status(400).json({
        error: message,
        details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}
