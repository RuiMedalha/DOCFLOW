/**
 * Named rate-limit definitions used by @Throttle('name').
 *
 * The names map to buckets declared in app.module.ts
 * (ThrottlerModule.forRoot([...])). Each bucket has its own TTL window
 * and request cap, applied per the tracker set by ThrottlerByGuard:
 *
 *   'login'    → 5 attempts / 15 min / per IP
 *   'extract'  → 10 / min / per tenant
 *   'export'   → 1  / min / per user
 *
 * Use these constants wherever you wire `@Throttle()` so the names
 * stay in sync with the bucket declarations.
 */
export const THROTTLE_NAMES = {
  LOGIN: 'login',
  EXTRACT: 'extract',
  EXPORT: 'export',
} as const;

export type ThrottleName =
  (typeof THROTTLE_NAMES)[keyof typeof THROTTLE_NAMES];