import { FleetService } from './fleet.service';

describe('FleetService', () => {
  it('creates a tenant-scoped vehicle and writes an audit event', async () => {
    const prisma = { fleetVehicle: { create: jest.fn().mockResolvedValue({ id: 'vehicle-1', plate: 'AA-00-AA' }) } } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new FleetService(prisma, audit);
    const result = await service.createVehicle('tenant-1', 'user-1', { plate: 'AA-00-AA', brand: 'Ford', model: 'Transit' });
    expect(result.id).toBe('vehicle-1');
    expect(prisma.fleetVehicle.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-1' }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'fleet_vehicle', entityId: 'vehicle-1' }));
  });
});
