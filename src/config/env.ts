import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_API_PORT: z.coerce.number().int().positive().default(4000),
  SFLIX_BASE_URL: z.string().min(1).default("local://consumet"),
  TMDB_API_TOKEN: z.string().min(1),
  TMDB_DEFAULT_LANGUAGE: z.string().default("id-ID"),
  TMDB_FALLBACK_LANGUAGE: z.string().default("en-US"),
  TMDB_IMAGE_BASE_URL: z.string().url().default("https://image.tmdb.org/t/p/w500"),
  OPENSUBTITLES_API_BASE_URL: z.string().url().default("https://api.opensubtitles.com/api/v1"),
  OPENSUBTITLES_API_KEY: z.string().min(1).optional(),
  OPENSUBTITLES_USER_AGENT: z.string().default("sflix-catalog-bot v0.1.0"),
  OPENSUBTITLES_TARGET_LANGUAGE: z.string().default("id"),
  OPENSUBTITLES_DOWNLOADS_ENABLED: z.coerce.boolean().default(false),
  OPENSUBTITLES_USERNAME: z.string().optional(),
  OPENSUBTITLES_PASSWORD: z.string().optional(),
  INGEST_DEFAULT_LIMIT: z.coerce.number().int().positive().default(3)
});

export const env = envSchema.parse(process.env);
