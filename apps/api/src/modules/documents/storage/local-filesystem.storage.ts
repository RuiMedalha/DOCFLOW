import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  GetObjectResult,
  PutObjectOptions,
  StorageService,
} from './storage-service.interface';

/**
 * Local-filesystem StorageService — default driver for development.
 *
 * Stores objects under `<project-root>/apps/api/uploads/` (configurable via
 * `UPLOADS_DIR`). Each object lives at `<uploadsDir>/<key>` with the key
 * being a relative POSIX path the caller built (e.g. tenantId/year/hash.ext).
 *
 * Security notes:
 *   - Keys are sanitized before joining to disk — no traversal, no absolute paths.
 *   - All writes are atomic via a temp-file rename (the public file never
 *     appears half-written).
 *   - File permissions follow the OS umask. In production, the uploads
 *     directory should sit outside the web root and be served via a
 *     controller route (we do that via `/documents/:id/download`).
 */
@Injectable()
export class LocalFilesystemStorage implements StorageService, OnModuleInit {
  readonly driver = 'local' as const;

  private readonly logger = new Logger(LocalFilesystemStorage.name);
  private readonly rootDir: string;

  constructor() {
    this.rootDir = path.resolve(
      process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads'),
    );
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    this.logger.log(`LocalFilesystemStorage ready at ${this.rootDir}`);
  }

  async put(
    key: string,
    buffer: Buffer,
    _options?: PutObjectOptions,
  ): Promise<void> {
    const target = this.resolveSafe(key);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Atomic write: write to temp then rename. Prevents readers from seeing
    // a half-written file if the process is killed mid-upload.
    const tmp = path.join(path.dirname(target), `.${crypto.randomBytes(8).toString('hex')}.part`);
    await fs.writeFile(tmp, buffer);
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async getBuffer(key: string): Promise<GetObjectResult> {
    const target = this.resolveSafe(key);
    try {
      const buffer = await fs.readFile(target);
      const stat = await fs.stat(target);
      return { buffer, size: stat.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException(`Object not found: ${key}`);
      }
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    const target = this.resolveSafe(key);
    try {
      await fs.unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // idempotent: missing key is fine
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveSafe(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, _ttlSeconds?: number): Promise<string> {
    // Local driver cannot sign — return a controller route. Callers must
    // resolve the documentId and call /documents/:id/download instead.
    // The returned key is informational; the controller maps it to the
    // authenticated download endpoint.
    return `/api/v1/documents/storage/${encodeURIComponent(key)}`;
  }

  /**
   * Sanitize a caller-supplied key and join it under the uploads root.
   * Throws on traversal attempts or absolute paths.
   */
  private resolveSafe(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }
    if (key.includes('\0')) {
      throw new Error('Storage key contains NUL byte');
    }
    // Normalize: reject absolute, reject traversal segments.
    const normalized = path.posix.normalize(key).replace(/^[/\\]+/, '');
    if (normalized.startsWith('..') || normalized.includes('../')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const resolved = path.resolve(this.rootDir, normalized);
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return resolved;
  }
}