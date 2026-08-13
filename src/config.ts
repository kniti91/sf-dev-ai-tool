import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ override: process.env.NODE_ENV !== 'production' })

const optionalString = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional())
const optionalEncryptionKey = z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^[a-fA-F0-9]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters.').optional())

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4500),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url(),
  AUTH_BYPASS: z.string().optional().transform((value) => value !== 'false'),
  SALESFORCE_CLIENT_ID: optionalString,
  SALESFORCE_CLIENT_SECRET: optionalString,
  SALESFORCE_REDIRECT_URI: z.string().url().default('http://localhost:4500/api/v1/org-connections/oauth/callback'),
  SALESFORCE_API_VERSION: z.string().regex(/^\d+\.0$/).default('61.0'),
  SALESFORCE_CONNECTOR_PACKAGE_VERSION_ID: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().regex(/^04t[a-zA-Z0-9]{12,15}$/, 'SALESFORCE_CONNECTOR_PACKAGE_VERSION_ID must be a Salesforce 04t package version ID.').optional(),
  ),
  TOKEN_ENCRYPTION_KEY: optionalEncryptionKey,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(90_000),
  SALESFORCE_CODE_ANALYZER_ENABLED: z.string().optional().transform((value) => value !== 'false'),
  SALESFORCE_CODE_ANALYZER_COMMAND: z.string().min(1).default(process.platform === 'win32' ? 'sf.cmd' : 'sf'),
  SALESFORCE_CODE_ANALYZER_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(180_000),
  SCAN_COMPONENT_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  AI_COMPONENT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
})

export const config = environmentSchema.parse(process.env)
