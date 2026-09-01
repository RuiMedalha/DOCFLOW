import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ConfigureIntegrationDto,
  OAuthAuthorizeDto,
  SyncIntegrationDto,
} from './dto/integrations.dto';
import { IntegrationsService } from './integrations.service';

/**
 * IntegrationsController — every provider's read/write surface lives
 * here. Provider-specific routes:
 *
 *   - POST /integrations/:provider/configure   (admin)
 *   - GET  /integrations                        (list)
 *   - POST /integrations/:provider/test
 *   - POST /integrations/:provider/authorize    (OAuth start)
 *   - GET  /integrations/:provider/callback     (OAuth end, public)
 *   - POST /integrations/:provider/sync         (admin)
 *   - POST /integrations/ifthenpay/callback     (public, anti-phishing)
 *   - POST /integrations/woocommerce/webhook    (public, HMAC verified)
 *   - POST /integrations/woocommerce/sync       (admin, manual backfill)
 */
@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly s: IntegrationsService) {}

  @Roles(Role.ADMIN)
  @Post(':provider/configure')
  @ApiOperation({ summary: 'Configure integration (admin)' })
  configure(
    @CurrentUser() u: AuthenticatedUser,
    @Param('provider') p: string,
    @Body() d: ConfigureIntegrationDto,
  ) {
    return this.s.configure(u.tenantId, u.id, p, d);
  }

  @Get()
  @ApiOperation({ summary: 'List configured integrations for the tenant' })
  list(@CurrentUser() u: AuthenticatedUser) {
    return this.s.list(u.tenantId);
  }

  @Post(':provider/test')
  @ApiOperation({
    summary: 'Test an integration (returns whitelisted non-secret fields)',
  })
  test(
    @CurrentUser() u: AuthenticatedUser,
    @Param('provider') p: string,
  ) {
    return this.s.test(u.tenantId, p);
  }

  @Post(':provider/authorize')
  @ApiOperation({
    summary: 'Start OAuth flow — returns the provider authorization URL + state',
  })
  authorize(
    @CurrentUser() u: AuthenticatedUser,
    @Param('provider') p: string,
    @Body() d: OAuthAuthorizeDto,
  ) {
    return this.s.authorize(u.tenantId, p, d.redirectUri);
  }

  @Public()
  @Get(':provider/callback')
  @ApiOperation({
    summary: 'OAuth callback (provider → DocFlow)',
  })
  callback(
    @Param('provider') p: string,
    @Query('code') c: string,
    @Query('state') s: string,
  ) {
    return this.s.callback(p, c, s);
  }

  @Roles(Role.ADMIN)
  @Post(':provider/sync')
  @ApiOperation({ summary: 'Trigger a one-shot sync' })
  sync(
    @CurrentUser() u: AuthenticatedUser,
    @Param('provider') p: string,
    @Body() d: SyncIntegrationDto,
  ) {
    // WooCommerce has its own richer sync path.
    if (p === 'woocommerce') {
      return this.s.syncWooOrders(u.tenantId, u.id);
    }
    return this.s.sync(u.tenantId, u.id, p, d.payload);
  }

  @Public()
  @Post('ifthenpay/callback')
  @ApiOperation({ summary: 'Ifthenpay payment callback' })
  ifthenpay(
    @Query() q: Record<string, unknown>,
    @Body() b: Record<string, unknown>,
  ) {
    return this.s.ifthenpay({ ...q, ...b });
  }

  @Public()
  @Post('woocommerce/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'WooCommerce webhook receiver (HMAC verified)',
    description:
      'Validates the X-WC-Webhook-Signature against every active tenant config, then ingests the order as a Document with an upserted Party. Idempotent on externalId=woo:<id>.',
  })
  @ApiResponse({
    status: 401,
    description: 'Signature did not match any configured tenant secret',
  })
  async woocommerceWebhook(@Req() req: any) {
    const rawBody: string =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : req.rawBody?.toString
          ? req.rawBody.toString()
          : req.body
            ? JSON.stringify(req.body)
            : '';
    const signature = String(
      req.headers?.['x-wc-webhook-signature'] ?? '',
    );
    const tenantId = await this.s.verifyWooWebhook(rawBody, signature);
    return this.s.processWooWebhook(tenantId, rawBody);
  }
}