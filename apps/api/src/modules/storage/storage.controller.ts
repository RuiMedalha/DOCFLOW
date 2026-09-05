import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LocalFilesystemStorage } from '../documents/storage/local-filesystem.storage';

interface FsEntryDto {
  name: string;
  /** POSIX-style path RELATIVE to the tenant root, e.g. `_inbox/2026/09`. */
  path: string;
  kind: 'folder' | 'file';
  size?: number;
  modifiedAt?: string;
}

interface TreeResponseDto {
  /** POSIX path the caller asked for; `"/"` is the tenant root. */
  path: string;
  parent: string | null;
  folders: FsEntryDto[];
  files: FsEntryDto[];
}

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: LocalFilesystemStorage) {}

  /**
   * GET /storage/tree?path=/<subdir>
   *
   * Lists the contents of `<uploadsRoot>/<tenantId>/<path>` for the
   * authenticated tenant. The path is sanitized against `..`, absolute
   * paths, NUL bytes, and traversal segments — anything that escapes the
   * tenant root returns 400.
   *
   * The route is gated by JwtGuard + TenantGuard globally; we never read
   * `tenantId` from the query string. Empty path means the tenant root.
   *
   * NOTE: today this controller uses the `LocalFilesystemStorage` driver
   * directly. When we move to S3/MinIO, swap the underlying impl for an
   * `S3StorageAdapter` that does prefix listing.
   */
  @Get('tree')
  @ApiOperation({
    summary: 'List files and folders under a tenant path',
    description:
      'Returns immediate children of `<uploadsRoot>/<tenantId>/<path>`. ' +
      '`path` is the relative directory inside the tenant root (use `/` or ' +
      'empty for the root). Path traversal attempts return 400.',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    example: '/_inbox/2026',
    description:
      'Tenant-scoped relative path. Default: `/`. Must NOT contain `..`.',
  })
  @ApiResponse({ status: 200, description: 'Tree node (folders + files)' })
  @ApiResponse({ status: 400, description: 'Invalid path (traversal, abs, NUL)' })
  @ApiResponse({ status: 404, description: 'Path does not exist' })
  async tree(
    @CurrentUser() user: AuthenticatedUser,
    @Query('path') rawPath?: string,
  ): Promise<TreeResponseDto> {
    const tenantId = user.tenantId;
    if (!tenantId) {
      // Defence in depth — JwtGuard should always set this, but if a future
      // refactor breaks the contract we refuse to list anything.
      throw new NotFoundException('tenant not resolved');
    }

    const cleaned = sanitizePath(rawPath ?? '/');
    const tenantRoot = this.storage.uploadsRoot;
    const tenantRootAbs = path.resolve(tenantRoot, tenantId);
    // `path.resolve(root, 'tenant', '/_inbox')` on Windows interprets the
    // leading `/` as a drive-absolute path and returns `C:\` instead of
    // staying under the tenant root. Strip the leading slash on the
    // tenant-relative segment so resolve() walks down from the tenant
    // root instead of jumping back to the drive root.
    const relativeToTenant = cleaned.replace(/^\/+/, '');
    const absolute = relativeToTenant
      ? path.resolve(tenantRootAbs, relativeToTenant)
      : tenantRootAbs;

    // Belt-and-suspenders: even after sanitizePath we double-check that
    // the absolute path stays under the tenant root.
    if (!absolute.startsWith(tenantRootAbs)) {
      throw new BadRequestException('path escapes tenant root');
    }

    let dirents: import('fs').Dirent[];
    try {
      dirents = await fs.readdir(absolute, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Path doesn't exist — return an empty listing instead of 404 so
        // the UI can render a "no docs here yet" state.
        return {
          path: cleaned,
          parent: parentOf(cleaned),
          folders: [],
          files: [],
        };
      }
      throw err;
    }

    const folders: FsEntryDto[] = [];
    const files: FsEntryDto[] = [];

    for (const d of dirents) {
      const rel = joinPosix(cleaned, d.name);
      if (d.isDirectory()) {
        folders.push({ name: d.name, path: rel, kind: 'folder' });
        continue;
      }
      if (d.isFile()) {
        const stat = await fs.stat(path.join(absolute, d.name)).catch(() => null);
        files.push({
          name: d.name,
          path: rel,
          kind: 'file',
          size: stat?.size,
          modifiedAt: stat?.mtime?.toISOString(),
        });
        continue;
      }
      // Skip symlinks and special files — never expose anything that
      // could be a traversal vector.
    }

    // Stable order: folders first by name, then files by name.
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    return {
      path: cleaned,
      parent: parentOf(cleaned),
      folders,
      files,
    };
  }
}

/**
 * Sanitize a user-supplied tenant path. Rejects:
 *   - non-string / empty (treated as "/")
 *   - any segment equal to `..` or starting with `..` after split
 *   - absolute paths (leading `/` after trimming is allowed since the
 *     caller may pass `/inbox/2026` style paths)
 *   - NUL bytes
 *   - backslashes (Windows traversal via `..\\foo`)
 *   - control characters
 *
 * Returns a normalized POSIX path. Empty string → "/".
 */
function sanitizePath(raw: string): string {
  if (typeof raw !== 'string') return '/';
  let s = raw.trim();
  if (!s || s === '/') return '/';
  if (s.includes('\0')) {
    throw new BadRequestException('path contains NUL byte');
  }
  if (/[\x00-\x1f]/.test(s)) {
    throw new BadRequestException('path contains control character');
  }
  // Reject Windows-style backslashes entirely — we operate in POSIX.
  if (s.includes('\\')) {
    throw new BadRequestException('path uses backslashes');
  }
  // Strip leading slash for normalization, then re-add on output.
  const stripped = s.replace(/^\/+/, '');
  const segments = stripped.split('/').filter((seg) => seg.length > 0);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new BadRequestException('path traversal not allowed');
    }
  }
  return '/' + segments.join('/');
}

function joinPosix(parent: string, child: string): string {
  if (parent === '/' || parent === '') return '/' + child;
  return parent + '/' + child;
}

function parentOf(p: string): string | null {
  if (!p || p === '/' || p === '') return null;
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}
