import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EmployeeStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildSepaPain001Xml } from '../payments/iso20022-sepa.builder';
import { CreateEmployeeDto, CreatePayrollPeriodDto, GeneratePayrollDto, PayrollSepaDto, UpdateEmployeeDto } from './dto/payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async createEmployee(tenantId: string, userId: string, dto: CreateEmployeeDto) {
    const employee = await this.prisma.employee.create({ data: { tenantId, ...dto, hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined } });
    await this.log(tenantId, userId, AuditAction.CREATE, 'employee', employee.id);
    return employee;
  }
  listEmployees(tenantId: string) { return this.prisma.employee.findMany({ where: { tenantId }, orderBy: { fullName: 'asc' } }); }
  async getEmployee(tenantId: string, id: string) { return this.requireEmployee(tenantId, id); }
  async updateEmployee(tenantId: string, userId: string, id: string, dto: UpdateEmployeeDto) {
    await this.requireEmployee(tenantId, id);
    const employee = await this.prisma.employee.update({ where: { id }, data: { ...dto, hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined } });
    await this.log(tenantId, userId, AuditAction.EDIT, 'employee', id); return employee;
  }
  async deleteEmployee(tenantId: string, userId: string, id: string) {
    await this.requireEmployee(tenantId, id); await this.prisma.employee.delete({ where: { id } });
    await this.log(tenantId, userId, AuditAction.DELETE, 'employee', id); return { id, deleted: true };
  }
  async createPeriod(tenantId: string, userId: string, dto: CreatePayrollPeriodDto) {
    const period = await this.prisma.payrollPeriod.create({ data: { tenantId, year: dto.year, month: dto.month } });
    await this.log(tenantId, userId, AuditAction.CREATE, 'payroll_period', period.id); return period;
  }
  listPeriods(tenantId: string) { return this.prisma.payrollPeriod.findMany({ where: { tenantId }, include: { _count: { select: { items: true } } }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }); }
  async generate(tenantId: string, userId: string, periodId: string, dto: GeneratePayrollDto) {
    const period = await this.requirePeriod(tenantId, periodId);
    if (period.status !== PayrollPeriodStatus.OPEN) throw new BadRequestException('Payroll period is closed');
    const existing = await this.prisma.payrollItem.count({ where: { tenantId, periodId } });
    if (existing && !dto.overwrite) throw new BadRequestException('Payroll items already generated; use overwrite for draft regeneration');
    if (existing) await this.prisma.payrollItem.deleteMany({ where: { tenantId, periodId, status: 'DRAFT' } });
    const employees = await this.prisma.employee.findMany({ where: { tenantId, status: EmployeeStatus.ATIVO } });
    const items = employees.map((employee) => {
      // H-04: keep ALL payroll math in Prisma.Decimal so we never round
      // through JS number (gross * 0.11 on a 10.000€ gross = 1100.0000000000002
      // before rounding). The previous version did `gross * irsRate` on
      // Number, then re-rounded — for large salaries this drifts by 1 cent
      // and triggers journal-line mismatches at month-end.
      const rawGross = employee.grossMonthly ?? employee.baseSalary ?? new Prisma.Decimal(0);
      const gross = new Prisma.Decimal(rawGross);
      const irsRateDecimal = new Prisma.Decimal(this.irsRate(Number(gross), employee.irtConfig));
      const ssEmployeeRate = new Prisma.Decimal('0.11');
      const ssEmployerRate = new Prisma.Decimal('0.2375');

      const irtTax = gross.times(irsRateDecimal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const ssEmployee = gross.times(ssEmployeeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const ssEmployer = gross.times(ssEmployerRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const netSalary = gross.minus(irtTax).minus(ssEmployee).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      return {
        tenantId,
        periodId,
        employeeId: employee.id,
        baseSalary: gross,
        grossSalary: gross,
        irtTax,
        ssEmployee,
        ssEmployer,
        netSalary,
        breakdown: {
          irsRate: Number(irsRateDecimal),
          ssEmployeeRate: 0.11,
          ssEmployerRate: 0.2375,
        } as Prisma.InputJsonValue,
      };
    });
    if (items.length) await this.prisma.payrollItem.createMany({ data: items });
    await this.refreshTotals(tenantId, periodId); await this.log(tenantId, userId, AuditAction.CREATE, 'payroll_generation', periodId, { employees: items.length });
    return this.getPeriod(tenantId, periodId);
  }
  async getPeriod(tenantId: string, id: string) { await this.requirePeriod(tenantId, id); return this.prisma.payrollPeriod.findFirstOrThrow({ where: { id, tenantId }, include: { items: { include: { employee: true } } } }); }
  async close(tenantId: string, userId: string, id: string) {
    const period = await this.requirePeriod(tenantId, id); if (period.status !== PayrollPeriodStatus.OPEN) throw new BadRequestException('Period is not open');
    await this.refreshTotals(tenantId, id); const closed = await this.prisma.payrollPeriod.update({ where: { id }, data: { status: PayrollPeriodStatus.CLOSED, closedAt: new Date() } });
    await this.log(tenantId, userId, AuditAction.APPROVE, 'payroll_period', id); return closed;
  }
  async exportSepa(tenantId: string, userId: string, id: string, dto: PayrollSepaDto) {
    const period = await this.getPeriod(tenantId, id); if (!period.items.length) throw new BadRequestException('No payroll items to export');
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true, iban: true, bic: true } });
    if (!tenant?.iban) throw new BadRequestException('Tenant has no IBAN configured');
    const missing = period.items.filter((item) => !item.employee.iban); if (missing.length) throw new BadRequestException('All employees need an IBAN before SEPA export');
    const executionDate = dto.requestedExecutionDate ? new Date(dto.requestedExecutionDate) : new Date(); const messageId = `PAY-${period.year}${String(period.month).padStart(2, '0')}-${Date.now()}`;
    const xml = buildSepaPain001Xml({ messageId, creationDate: new Date(), initiatingPartyName: tenant.name, instructions: [{ paymentInformationId: messageId, requestedExecutionDate: executionDate, debtorName: tenant.name, debtorIban: tenant.iban, debtorBic: tenant.bic, transfers: period.items.map((item) => ({ endToEndId: item.id, amount: Number(item.netSalary), creditorName: item.employee.fullName, creditorIban: item.employee.iban!, remittanceInformation: `Salario ${period.month}/${period.year}` })) }] });
    await this.log(tenantId, userId, AuditAction.EXPORT, 'payroll_sepa', id, { messageId, items: period.items.length }); return { messageId, xml, numberOfTransactions: period.items.length };
  }
  async payslip(tenantId: string, id: string) { const item = await this.prisma.payrollItem.findFirst({ where: { id, tenantId }, include: { employee: true, period: true } }); if (!item) throw new NotFoundException('Payroll item not found'); return { type: 'payslip_stub', item, message: 'PDF generation is pending; this is the receipt payload.' }; }
  private async refreshTotals(tenantId: string, periodId: string) {
    // H-04: sum Decimals, not JS numbers — keeps rounding deterministic
    // across the worker and the SQL aggregate.
    const rows = await this.prisma.payrollItem.findMany({
      where: { tenantId, periodId },
      select: {
        grossSalary: true,
        netSalary: true,
        irtTax: true,
        ssEmployee: true,
        ssEmployer: true,
      },
    });
    const ZERO = new Prisma.Decimal(0);
    const sum = (key: 'grossSalary' | 'netSalary' | 'irtTax' | 'ssEmployee' | 'ssEmployer') =>
      rows
        .reduce<Prisma.Decimal>((acc, row) => acc.plus(new Prisma.Decimal(row[key] ?? 0)), ZERO)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        totalGross: sum('grossSalary'),
        totalNet: sum('netSalary'),
        totalTax: sum('irtTax'),
        totalSS: sum('ssEmployee').plus(sum('ssEmployer')),
      },
    });
  }
  private irsRate(gross: number, config: Prisma.JsonValue | null): number { const configured = config && typeof config === 'object' && !Array.isArray(config) ? Number((config as Record<string, unknown>).rate) : NaN; if (Number.isFinite(configured) && configured >= 0) return configured > 1 ? configured / 100 : configured; if (gross <= 920) return 0; if (gross <= 1400) return .13; if (gross <= 2200) return .18; if (gross <= 3200) return .23; return .28; }
  /** Round a Decimal (or numeric) to 2 places using banker-safe half-up. */
  private money(value: Prisma.Decimal | number): Prisma.Decimal {
    return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  private async requireEmployee(tenantId: string, id: string) { const row = await this.prisma.employee.findFirst({ where: { id, tenantId } }); if (!row) throw new NotFoundException('Employee not found'); return row; }
  private async requirePeriod(tenantId: string, id: string) { const row = await this.prisma.payrollPeriod.findFirst({ where: { id, tenantId } }); if (!row) throw new NotFoundException('Payroll period not found'); return row; }
  private log(tenantId: string, userId: string, action: AuditAction, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) { return this.audit.log({ tenantId, userId, action, entityType, entityId, metadata }); }
}
