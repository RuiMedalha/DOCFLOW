import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
export class ConfigureIntegrationDto { @ApiProperty({ type: Object }) @IsObject() credentials!: Record<string, unknown>; @ApiProperty({ type: Object, required: false }) @IsOptional() @IsObject() config?: Record<string, unknown>; }
export class OAuthAuthorizeDto { @ApiProperty({ required: false }) @IsOptional() @IsString() redirectUri?: string; }
export class SyncIntegrationDto { @ApiProperty({ required: false, type: Object }) @IsOptional() @IsObject() payload?: Record<string, unknown>; }
