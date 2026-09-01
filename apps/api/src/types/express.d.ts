// Augment Express Request with the runtime fields we attach:
//   - user:    the verified JWT payload set by JwtGuard
//   - tenantId: convenience alias for user.tenant_id set by TenantMiddleware
//   - requestId: per-request correlation id set by TenantMiddleware
//
// Kept in a separate file so it is auto-loaded by TypeScript at compile time
// (the project's tsconfig includes "src/**/*.ts").
import type { DocFlowJwtPayload } from '../common/guards/jwt.guard';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      user?: DocFlowJwtPayload;
      tenantId?: string;
      requestId?: string;
    }
  }
}

export {};
