import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthService, AuthenticatedResponse, Pending2FAResponse } from './auth.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { LoginDto } from './dto/login.dto';
import {
  LogoutDto,
  RefreshTokenDto,
} from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { TwoFactorDisableDto, TwoFactorSetupDto, TwoFactorVerifyDto } from './dto/two-factor.dto';
import { PasskeyChallengeDto, PasskeyVerifyDto } from './dto/passkey.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_NAMES } from '../../common/throttle/throttle.constants';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly passkeys: PasskeyService,
  ) {}

  // ============================================================ registration
  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new tenant + first admin user' })
  @ApiResponse({ status: 201, description: 'Tenant + admin created; tokens returned' })
  @ApiResponse({ status: 409, description: 'Tenant slug already in use' })
  async register(@Body() dto: RegisterDto): Promise<AuthenticatedResponse> {
    return this.auth.register(dto);
  }

  // ================================================================ login
  // Hard rate limit per IP (bucket 'login'). @Throttle('login') OVERRIDES the
  // global 100/min limit; the bucket is declared in app.module.ts.
  // Production: 5 attempts / 15 min (brute-force defence). Non-prod: relaxed to
  // 50 so local UAT / demos are not locked out mid-session.
  @Public()
  @Throttle({
    [THROTTLE_NAMES.LOGIN]: {
      ttl: 15 * 60 * 1000,
      limit: process.env.NODE_ENV === 'production' ? 5 : 50,
    },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email + password + tenantSlug. Returns tokens, or a 2FA challenge.' })
  @ApiResponse({ status: 200, description: 'Authenticated OR 2FA required' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthenticatedResponse | Pending2FAResponse> {
    return this.auth.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ============================================================== refresh
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue a fresh access+refresh pair' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // =============================================================== logout
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoutDto) {
    return this.auth.logout(user.id, user.tenantId, dto.refreshToken);
  }

  // ===================================================================== me
  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Current user profile + tenant summary' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  // ============================================================== invite
  @Post('invite')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Invite a new user into the inviter’s tenant (returns a one-time temp password)' })
  @ApiResponse({ status: 201, description: 'User created with temporary password' })
  @ApiResponse({ status: 409, description: 'User already exists in tenant' })
  async invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return this.auth.inviteUser(user.id, user.tenantId, dto);
  }

  // ============================================================ 2FA setup
  @Post('2fa/setup')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin 2FA enrollment: issue secret + QR code (does not enable yet)' })
  async setup2fa(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.generateSecret(user.id);
  }

  @Post('2fa/enable')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the first TOTP code and enable 2FA' })
  async enable2fa(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorSetupDto) {
    return this.twoFactor.enable(user.id, dto.token);
  }

  @Post('2fa/disable')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA — requires current password + last TOTP code' })
  async disable2fa(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorDisableDto) {
    return this.twoFactor.disable(user.id, dto.password, dto.token);
  }

  @Post('2fa/verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a TOTP code against the user’s stored secret (debug / wallet-less flows)' })
  async verify2fa(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorVerifyDto) {
    // Uses an internal helper so /login and this endpoint share the same verification path.
    const ok = await this.twoFactor.verifyForUser(user.id, dto.token);
    return { valid: ok };
  }

  // ========================================================== passkeys (skeleton)
  @Public()
  @Post('passkey/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a WebAuthn challenge for registration or authentication (skeleton)' })
  async passkeyChallenge(@Body() dto: PasskeyChallengeDto) {
    return this.passkeys.issueChallenge(dto.email);
  }

  @Public()
  @Post('passkey/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a passkey assertion (C-05 hard-disabled — returns not_implemented)' })
  async passkeyVerify(@Body() dto: PasskeyVerifyDto) {
    const result = this.passkeys.verify({
      challengeId: dto.challengeId,
      credential: dto.credential,
      expectedType: 'authentication',
    });
    // C-05: even though PasskeyService already refuses `verified: true`, this
    // is the belt-and-braces guard. If a downstream caller ever tries to use
    // this endpoint as proof of authentication (e.g. by trusting the result
    // and minting a session), this assertion will throw — preventing the
    // wiring that the previous skeleton would have allowed.
    if (result.verified === true) {
      throw new Error(
        'passkey/verify returned verified:true — this MUST be impossible until ' +
          '@simplewebauthn/server is wired. Check PasskeyService.verify().',
      );
    }
    return result;
  }
}
