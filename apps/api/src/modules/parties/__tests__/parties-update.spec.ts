import { ForbiddenException } from '@nestjs/common';
import { PartiesService } from '../parties.service';

/**
 * Defense-in-depth: the @Patch('parties/:id') route is gated by
 * @Roles(Role.ADMIN), but a direct service caller (queue, cron, test) could
 * still try to flip isRecurring. Verify that the service rejects non-ADMIN
 * callers and accepts ADMIN callers.
 */

const buildPrisma = () =>
  ({
    party: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'party-1',
        name: 'Acme',
        iban: null,
        nif: '123456789',
        type: 'FORNECEDOR',
        isActive: true,
      }),
      update: jest.fn().mockResolvedValue({
        id: 'party-1',
        name: 'Acme',
        iban: null,
        nif: '123456789',
        type: 'FORNECEDOR',
        isActive: true,
        isRecurring: true,
        isRecurringManualOverride: true,
      }),
    },
    ibanBlacklist: { findFirst: jest.fn().mockResolvedValue(null) },
    ibanHistory: { create: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((arr) => Promise.all(arr)),
  }) as any;

const buildAudit = () =>
  ({
    log: jest.fn().mockResolvedValue(undefined),
  }) as any;

/**
 * The service's `update()` calls `this.findOne()` at the end to return the
 * fresh DB row. We patch the prototype so it short-circuits to the same
 * shape we passed to update() — keeps the test independent of Prisma calls.
 */
function patchFindOne(svc: PartiesService, payload: any) {
  (svc as any).findOne = jest.fn().mockResolvedValue(payload);
}

describe('PartiesService.update — ADMIN-only isRecurring / isRecurringManualOverride', () => {
  it('rejects non-ADMIN trying to change isRecurring', async () => {
    const svc = new PartiesService(buildPrisma(), buildAudit());

    await expect(
      svc.update(
        'tenant-1',
        'user-1',
        'party-1',
        { isRecurring: true } as any,
        'OPERADOR',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects non-ADMIN trying to change isRecurringManualOverride', async () => {
    const svc = new PartiesService(buildPrisma(), buildAudit());

    await expect(
      svc.update(
        'tenant-1',
        'user-1',
        'party-1',
        { isRecurringManualOverride: true } as any,
        'OPERADOR',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ADMIN to change both fields', async () => {
    const prisma = buildPrisma();
    const svc = new PartiesService(prisma, buildAudit());
    patchFindOne(svc, {
      id: 'party-1',
      isRecurring: true,
      isRecurringManualOverride: true,
    });

    const result = await svc.update(
      'tenant-1',
      'admin-1',
      'party-1',
      { isRecurring: true, isRecurringManualOverride: true } as any,
      'ADMIN',
    );

    expect(result.isRecurring).toBe(true);
    expect(result.isRecurringManualOverride).toBe(true);
    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'party-1' },
        data: expect.objectContaining({
          isRecurring: true,
          isRecurringManualOverride: true,
        }),
      }),
    );
  });

  it('allows ADMIN to change isRecurring without overriding', async () => {
    const prisma = buildPrisma();
    const svc = new PartiesService(prisma, buildAudit());
    patchFindOne(svc, { id: 'party-1' });

    await svc.update(
      'tenant-1',
      'admin-1',
      'party-1',
      { isRecurringManualOverride: true } as any,
      'ADMIN',
    );

    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isRecurringManualOverride: true }),
      }),
    );
  });
});
