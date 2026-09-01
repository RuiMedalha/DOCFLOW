import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ImapConfigDto {
  @ApiProperty({ example: 'imap.example.com' })
  @IsString()
  host!: string;

  @ApiPropertyOptional({ example: 993, default: 993 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @ApiProperty({ example: 'invoices@example.com' })
  @IsString()
  user!: string;

  @ApiProperty({ description: 'IMAP password or app password', writeOnly: true })
  @IsString()
  pass!: string;

  @ApiPropertyOptional({ default: 'INBOX' })
  @IsOptional()
  @IsString()
  mailbox?: string;

  @ApiPropertyOptional({ default: true, description: 'Mark successfully processed messages as read' })
  @IsOptional()
  @IsBoolean()
  markSeen?: boolean;
}
