/**
 * StorageService — provider-agnostic object-storage interface.
 *
 * Designed so that the LocalFilesystem driver (default in dev) and an S3 /
 * MinIO driver can swap without changing business code. Every driver
 * implements the same minimal surface; key shape is opaque to callers.
 *
 * Key contract:
 *   - Keys are POSIX-style relative paths, e.g. `<tenantId>/<yyyy>/<...>`
 *   - Keys MUST be safe (no `..`, no leading `/`). Drivers may prefix with
 *     a bucket; they MUST NOT trust caller input verbatim.
 *   - getBuffer() throws NotFoundException if the object is missing.
 *   - getSignedUrl() is best-effort: local driver returns a relative path,
 *     S3/MinIO driver returns a presigned URL with TTL.
 */

export interface PutObjectOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  buffer: Buffer;
  contentType?: string;
  size: number;
}

export interface StorageService {
  /**
   * Persist `buffer` at `key`. Overwrites if it exists (object storage is
   * key/value; we never rely on partial updates).
   */
  put(key: string, buffer: Buffer, options?: PutObjectOptions): Promise<void>;

  /**
   * Stream the bytes back. Implementations must throw NotFoundException
   * (NOT a generic Error) when the key is missing — the controller maps
   * that to HTTP 404.
   */
  getBuffer(key: string): Promise<GetObjectResult>;

  /**
   * Remove an object. Idempotent — deleting a missing key is NOT an error.
   */
  remove(key: string): Promise<void>;

  /**
   * Cheap existence probe. Used by health checks and the cleanup job.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Return a URL the client can use to fetch the file. Local driver
   * returns the controller route `/api/v1/documents/<id>/download`. S3/MinIO
   * returns a presigned URL. Returned value is opaque to callers — only
   * the controller surfaces it to the user.
   */
  getSignedUrl(key: string, ttlSeconds?: number): Promise<string>;

  /**
   * Driver label for logging/metrics.
   */
  readonly driver: 'local' | 's3' | 'minio';
}

/** Nest DI token for the provider-agnostic storage interface. */
export const StorageService = Symbol('StorageService');
