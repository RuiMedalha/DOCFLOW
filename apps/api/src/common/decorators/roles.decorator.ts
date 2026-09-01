import { SetMetadata } from '@nestjs/common';
import { Role } from '../guards/rbac.guard';

export const ROLES_KEY = 'docflow:roles';

/**
 * Mark a controller or handler as requiring ONE OF the given roles. Read by
 * RbacGuard. Use sparingly — fine-grained permissions live on the User
 * (`canApprovePayments`, etc.) and should be checked in services, not via
 * route-level decorators.
 *
 *   @Roles(Role.ADMIN, Role.CONTABILIDADE)
 *   @Get('reports')
 *   reports() { ... }
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
