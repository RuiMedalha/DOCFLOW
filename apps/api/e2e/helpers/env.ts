import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load `.env` files without adding a dotenv dependency.
 * Later files do not override keys already present in process.env.
 */
export function loadEnvFiles(): void {
  const candidates = [
    resolve(__dirname, '..', '..', '.env'),
    resolve(__dirname, '..', '..', '..', '..', '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnvFiles();

export const API_BASE =
  process.env.API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4000/api/v1';

export const WEB_BASE =
  process.env.WEB_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export const DATABASE_URL = process.env.DATABASE_URL || '';

export const JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '';

export const JWT_ISSUER = process.env.JWT_ISSUER || 'docflow';
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'docflow-api';
