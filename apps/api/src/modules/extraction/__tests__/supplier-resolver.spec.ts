import { SupplierResolver } from '../supplier-resolver';

/**
 * The `refreshRecurringFlag` helper auto-flips `isRecurring` on a party
 * once the document count crosses RECURRING_THRESHOLD (=3). When the ADMIN
 * sets `isRecurringManualOverride = true`, the auto-flip MUST pause and
 * return the locked value as-is. This test pins both branches.
 */

const buildPrisma = (opts: {
  override: boolean;
  lockedIsRecurring: boolean;
  docCount: number;
}) => ({
  party: {
    findFirst: jest.fn().mockResolvedValue({
      isRecurringManualOverride: opts.override,
      isRecurring: opts.lockedIsRecurring,
    }),
    update: jest.fn(),
  },
  document: {
    count: jest.fn().mockResolvedValue(opts.docCount),
  },
}) as any;

describe('SupplierResolver.refreshRecurringFlag — ADMIN override guard', () => {
  it('does NOT flip when isRecurringManualOverride=true and returns the locked value', async () => {
    const prisma = buildPrisma({
      override: true,
      lockedIsRecurring: false,
      docCount: 10, // would normally flip
    });
    const resolver = new SupplierResolver(prisma);

    // Access private helper via cast for unit-test purposes.
    const result = await (resolver as any).refreshRecurringFlag(
      'tenant-1',
      'party-1',
      0,
    );

    expect(result).toBe(false); // the locked value (false), not auto-flip true
    expect(prisma.party.update).not.toHaveBeenCalled();
  });

  it('flips normally when isRecurringManualOverride=false and threshold crossed', async () => {
    const prisma = buildPrisma({
      override: false,
      lockedIsRecurring: false,
      docCount: 3, // == RECURRING_THRESHOLD
    });
    const resolver = new SupplierResolver(prisma);

    const result = await (resolver as any).refreshRecurringFlag(
      'tenant-1',
      'party-1',
      0,
    );

    expect(result).toBe(true);
    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'party-1' },
        data: { isRecurring: true },
      }),
    );
  });

  it('returns locked true and does NOT downgrade when override is on even if doc count is low', async () => {
    const prisma = buildPrisma({
      override: true,
      lockedIsRecurring: true,
      docCount: 0, // would normally NOT flip — but party is locked at true
    });
    const resolver = new SupplierResolver(prisma);

    const result = await (resolver as any).refreshRecurringFlag(
      'tenant-1',
      'party-1',
      0,
    );

    expect(result).toBe(true); // returns the locked true
    expect(prisma.party.update).not.toHaveBeenCalled();
  });
});
