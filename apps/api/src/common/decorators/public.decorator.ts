import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'docflow:isPublic';

/**
 * Mark a route as public — JwtGuard and TenantGuard will skip token/tenant
 * checks for it. Use ONLY for true unauthenticated endpoints (login, health,
 * signup). NEVER mark business endpoints public; the Prisma extension will
 * refuse tenant-scoped queries from a public route, which is the desired
 * default-deny behavior.
 *
 *   @Public()
 *   @Post('login')
 *   login(@Body() dto: LoginDto) { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
