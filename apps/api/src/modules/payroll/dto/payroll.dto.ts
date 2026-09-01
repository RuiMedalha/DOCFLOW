import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EmployeeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty() @IsString() employeeNumber!: string;
  @ApiProperty() @IsString() fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nif?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() niss?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;
  @ApiPropertyOptional({ example: 1250 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) grossMonthly?: number;
  @ApiPropertyOptional({ enum: EmployeeStatus }) @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() hireDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
}
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
export class CreatePayrollPeriodDto {
  @ApiProperty({ example: 2026 }) @Type(() => Number) @IsInt() @Min(2020) year!: number;
  @ApiProperty({ example: 8 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
}
export class GeneratePayrollDto {
  @ApiPropertyOptional({ description: 'Overwrite existing draft items' }) @IsOptional() overwrite?: boolean;
}
export class PayrollSepaDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() requestedExecutionDate?: string;
}
