/**
 * Re-exports of the internal helpers used by the Prisma tenant-scope
 * extension, exposed only so the unit tests can import them directly.
 *
 * NOT part of the public API; do not import from feature modules.
 */
export { injectTenantId, mergeTenantFilter } from './prisma.helpers';