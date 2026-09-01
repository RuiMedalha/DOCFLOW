import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator'; import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy'; import { Roles } from '../../common/decorators/roles.decorator'; import { Role } from '../../common/guards/rbac.guard';
import { PayrollService } from './payroll.service'; import { CreateEmployeeDto, CreatePayrollPeriodDto, GeneratePayrollDto, PayrollSepaDto, UpdateEmployeeDto } from './dto/payroll.dto';
@ApiTags('payroll') @ApiBearerAuth() @Roles(Role.ADMIN, Role.GESTOR_RH) @Controller('payroll')
export class PayrollController { constructor(private readonly payroll: PayrollService) {}
  @Post('employees') @ApiOperation({ summary: 'Create employee' }) createEmployee(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateEmployeeDto) { return this.payroll.createEmployee(u.tenantId, u.id, dto); }
  @Get('employees') listEmployees(@CurrentUser() u: AuthenticatedUser) { return this.payroll.listEmployees(u.tenantId); }
  @Get('employees/:id') getEmployee(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) { return this.payroll.getEmployee(u.tenantId, id); }
  @Patch('employees/:id') updateEmployee(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) { return this.payroll.updateEmployee(u.tenantId, u.id, id, dto); }
  @Delete('employees/:id') deleteEmployee(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) { return this.payroll.deleteEmployee(u.tenantId, u.id, id); }
  @Post('periods') createPeriod(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreatePayrollPeriodDto) { return this.payroll.createPeriod(u.tenantId, u.id, dto); }
  @Get('periods') listPeriods(@CurrentUser() u: AuthenticatedUser) { return this.payroll.listPeriods(u.tenantId); }
  @Get('periods/:id') getPeriod(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) { return this.payroll.getPeriod(u.tenantId, id); }
  @Post('periods/:id/generate') generate(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: GeneratePayrollDto) { return this.payroll.generate(u.tenantId, u.id, id, dto); }
  @Post('periods/:id/close') @HttpCode(HttpStatus.OK) close(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) { return this.payroll.close(u.tenantId, u.id, id); }
  @Post('periods/:id/sepa') exportSepa(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: PayrollSepaDto) { return this.payroll.exportSepa(u.tenantId, u.id, id, dto); }
  @Get('payslips/:id') payslip(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) { return this.payroll.payslip(u.tenantId, id); }
}
