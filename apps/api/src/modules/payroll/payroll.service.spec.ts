import { Prisma } from '@prisma/client';
import { PayrollService } from './payroll.service';

describe('PayrollService', () => {
  const prisma = {} as never;
  const audit = { log: jest.fn() } as never;
  const service = new PayrollService(prisma, audit);

  it('calculates the configured IRS rate before the simplified table', () => {
    expect((service as any).irsRate(3000, { rate: 15 })).toBe(0.15);
    expect((service as any).irsRate(800, null)).toBe(0);
    expect((service as any).irsRate(1800, null)).toBe(0.18);
  });

  it('H-04: rounds money to two decimal places using Prisma.Decimal', () => {
    const result = (service as any).money(new Prisma.Decimal('123.456')) as Prisma.Decimal;
    expect(result.toString()).toBe('123.46');
  });

  it('H-04: money() never produces a JS float (always Decimal)', () => {
    const result = (service as any).money(0.1 + 0.2) as Prisma.Decimal;
    expect(result).toBeInstanceOf(Prisma.Decimal);
    // Decimal('0.3') — exact representation, not the float 0.30000000000004
    expect(result.toString()).toBe('0.3');
  });

  // H-04 property test: 100 random salaries must round to the cent
  // without ever drifting off the expected value due to float imprecision.
  it('H-04: property test — 100 random salaries never drift off the cent', () => {
    for (let i = 0; i < 100; i++) {
      // Random gross between 800 and 10000 EUR — pick fractional values
      // that would expose float drift (e.g. 0.1 + 0.2).
      const gross = Math.round((800 + Math.random() * 9200) * 100) / 100;
      const grossDec = new Prisma.Decimal(gross);
      const irsRate = new Prisma.Decimal((service as any).irsRate(gross, null));
      const expected = grossDec.times(irsRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const actual = (service as any).money(grossDec.times(irsRate)) as Prisma.Decimal;
      expect(actual.toString()).toBe(expected.toString());
    }
  });
});
