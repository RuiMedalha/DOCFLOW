import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ActivityType } from '@prisma/client';

/** POST /crm/activities — log a call/email/meeting/task/note/follow-up. */
export class CreateActivityDto {
  @ApiProperty({ enum: ActivityType })
  @IsEnum(ActivityType)
  type: ActivityType;

  @ApiProperty({ example: 'Follow-up call re: proposal v2' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiPropertyOptional({ example: 'Discussed pricing tier; will send revised proposal tomorrow.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ description: 'CRM contact (optional).' })
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional({ description: 'CRM deal (optional).' })
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional({
    example: '2026-09-15T10:00:00Z',
    description: 'Due date (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'User id the activity is assigned to. Defaults to the creator.',
  })
  @IsOptional()
  @IsString()
  assignedToId?: string;
}

/** PATCH /crm/activities/:id — partial update. */
export class UpdateActivityDto {
  @ApiPropertyOptional({ enum: ActivityType })
  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Mark complete; sets completedAt=now().' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  completed?: boolean;
}

/** GET /crm/activities — query filters. */
export class ActivityQueryDto {
  @ApiPropertyOptional({ enum: ActivityType })
  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional({ description: 'Filter by assignee.' })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({
    description: 'Show only incomplete activities (completedAt null).',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyPending?: boolean = false;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
