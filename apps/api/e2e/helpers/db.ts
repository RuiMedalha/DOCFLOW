import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DATABASE_URL } from './env';

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (!client) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is required for E2E data-consistency checks');
    }
    client = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  }
  return client;
}

export async function setTenantBankDetails(
  tenantId: string,
  iban: string,
  bic: string,
): Promise<void> {
  await db().tenant.update({
    where: { id: tenantId },
    data: { iban, bic, bankName: 'Caixa Geral de Depósitos' },
  });
}

export async function payableAmountAsString(id: string): Promise<string> {
  const row = await db().payableItem.findUnique({
    where: { id },
    select: { amount: true },
  });
  if (!row) throw new Error(`payable ${id} not found`);
  return row.amount.toFixed(2);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonical(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') +
    '}'
  );
}

function computeRowHash(prevHash: string | null, payload: string): string {
  return createHash('sha256')
    .update((prevHash ?? '') + payload)
    .digest('hex');
}

export async function verifyAuditChain(tenantId: string): Promise<{
  valid: boolean;
  brokenAt?: string;
  count: number;
}> {
  const rows = await db().auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });

  let expectedPrevHash: string | null = null;
  for (const row of rows) {
    if (row.prevHash !== expectedPrevHash) {
      return { valid: false, brokenAt: row.id, count: rows.length };
    }
    const payload = canonical({
      tenantId: row.tenantId,
      userId: row.userId ?? null,
      action: row.action,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      metadata: canonical(row.metadata ?? null),
      createdAt: row.createdAt.toISOString(),
    });
    const recomputed = computeRowHash(expectedPrevHash, payload);
    if (recomputed !== row.rowHash) {
      return { valid: false, brokenAt: row.id, count: rows.length };
    }
    expectedPrevHash = row.rowHash;
  }
  return { valid: true, count: rows.length };
}

export async function listAuditActions(tenantId: string): Promise<
  Array<{ action: string; entityType: string | null; userId: string | null; createdAt: Date }>
> {
  const rows = await db().auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { action: true, entityType: true, userId: true, createdAt: true },
  });
  return rows;
}

export async function countAuditForOtherTenant(
  ownerTenantId: string,
): Promise<number> {
  return db().auditLog.count({
    where: { tenantId: { not: ownerTenantId } },
  });
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
