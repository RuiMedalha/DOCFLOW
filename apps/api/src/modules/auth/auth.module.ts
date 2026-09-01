import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') ?? config.get<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256' as const,
          issuer: config.get<string>('JWT_ISSUER') ?? 'docflow',
          audience: config.get<string>('JWT_AUDIENCE') ?? 'docflow-api',
          expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TwoFactorService, PasskeyService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, TwoFactorService, PasskeyService, JwtAuthGuard],
})
export class AuthModule {}