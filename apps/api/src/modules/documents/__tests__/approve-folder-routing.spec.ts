import { AuditAction, DocumentStatus } from '@prisma/client';
import { DocumentsService } from '../documents.service';
import type { StorageService } from '../storage/storage-service.interface';

/**
 * Sprint E — after `approve()` flips a Document to APROVADO, the bytes
 * stored at `<tenant>/<yyyy>/<mm>/<ts>-<rand>.<ext>` should be relocated
 * to the deterministic party/category folder computed by path-builder.
 *
 * These tests stub the storage abstraction with a Jest mock and the
 * Prisma surface with per-test overrides — no real filesystem is
 * touched. The contract we pin:
 *   - `relocateAfterApprove()` only fires when the row has a party AND
 *     the current fileKey sits inside `_inbox/`.
 *   - `storage.move()` is called with the destination computed by
 *     `buildDocumentPath()` (deterministic — same input → same output).
 *   - The DB row is updated with the new fileKey / pdfKey AFTER the move
 *     succeeds.
 *   - An audit row tagged `storage.relocate` is written with from/to.
 *   - If the file is already outside `_inbox/` the move is a no-op
 *     (idempotent).
 */

const TENANT_ID = 'tenant-routing-test';
const USER_ID = 'user-1';
const DOC_ID = 'cm-approve-relocate';

function buildPrismaStub() {
  return {
    document: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    paymentEvent: {
      upsert: jest.fn(),
    },
  };
}

function buildAuditStub() {
  return {
    log: jest.fn(async () => undefined),
  };
}

function buildStorageStub(): StorageService & {
  move: jest.Mock;
} {
  return {
    driver: 'local',
    put: jest.fn(async () => undefined),
    getBuffer: jest.fn(async () => ({ buffer: Buffer.from(''), size: 0 })),
    remove: jest.fn(async () => undefined),
    exists: jest.fn(async () => true),
    move: jest.fn(async () => undefined),
    getSignedUrl: jest.fn(async (key: string) =>
      `/api/v1/documents/storage/${encodeURIComponent(key)}`,
    ),
  };
}

function buildRulesEngineStub() {
  return {
    suggest: jest.fn(async () => '/Inbox/2026/09/OUTRO'),
    render: jest.fn(),
    fallback: jest.fn(),
  };
}

function buildImageToPdfStub() {
  return {
    supports: jest.fn(() => false),
    convert: jest.fn(),
  };
}

function makeSvc(prisma: any, audit: any, storage: StorageService) {
  return new DocumentsService(
    prisma as any,
    audit as any,
    storage as any,
    buildRulesEngineStub() as any,
    { enqueue: jest.fn().mockResolvedValue({ queued: false, documentId: DOC_ID, ok: true }) } as any,
    buildImageToPdfStub() as any,
  );
}

describe('DocumentsService.approve() — Sprint E folder routing', () => {
  it('moves an _inbox/ file to the party/category folder and updates the DB', async () => {
    const prisma = buildPrismaStub();
    const audit = buildAuditStub();
    const storage = buildStorageStub();

    prisma.document.findFirst
      // 1st call: existing row read by approve()
      .mockResolvedValueOnce({
        id: DOC_ID,
        status: DocumentStatus.NOVO,
        dueDate: null,
        paymentDueDate: null,
        total: null,
        netAmount: null,
      })
      // 2nd call: relocateAfterApprove() row lookup
      .mockResolvedValueOnce({
        id: DOC_ID,
        fileKey: '<tenant>/2026/09/1788-abcdef.pdf',
        pdfKey: null,
        docDate: new Date(Date.UTC(2026, 8, 4)),
        docNumber: 'FT 2026/123',
        partyId: 'party-1',
        party: {
          id: 'party-1',
          name: 'EDP Comercial',
          slug: 'edp-comercial',
          type: 'FORNECEDOR',
          partyCategory: { slug: 'estrategico' },
        },
      });

    prisma.document.update.mockResolvedValue({
      id: DOC_ID,
      status: DocumentStatus.APROVADO,
    });

    // The `_inbox/` substring is what triggers the move.
    // Patch the fileKey so we exercise the routing branch.
    const findFirstMock = prisma.document.findFirst as jest.Mock;
    findFirstMock.mockReset();
    findFirstMock
      .mockResolvedValueOnce({
        id: DOC_ID,
        status: DocumentStatus.NOVO,
        dueDate: null,
        paymentDueDate: null,
        total: null,
        netAmount: null,
      })
      .mockResolvedValueOnce({
        id: DOC_ID,
        fileKey: 'cmtf1scz20000g5s0n621bzef/_inbox/2026-09-04/abc-1788.pdf',
        pdfKey: null,
        docDate: new Date(Date.UTC(2026, 8, 4)),
        docNumber: 'FT 2026/123',
        partyId: 'party-1',
        party: {
          id: 'party-1',
          name: 'EDP Comercial',
          slug: 'edp-comercial',
          type: 'FORNECEDOR',
          partyCategory: { slug: 'estrategico' },
        },
      });

    const svc = makeSvc(prisma, audit, storage);
    await svc.approve(TENANT_ID, USER_ID, DOC_ID);

    // storage.move() called with the deterministic destination.
    expect(storage.move).toHaveBeenCalledTimes(1);
    const [from, to] = (storage.move as jest.Mock).mock.calls[0];
    expect(from).toBe('cmtf1scz20000g5s0n621bzef/_inbox/2026-09-04/abc-1788.pdf');
    expect(to).toBe('fornecedores/edp-comercial/estrategico/2026-09/ft-2026-123-cm-appro.pdf');

    // DB update carries the new fileKey.
    const updateCall = prisma.document.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.fileKey,
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0].data.fileKey).toBe(to);

    // Audit row tagged with subAction.
    const relocateRow = (audit.log as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((entry: any) => entry.metadata?.subAction === 'storage.relocate');
    expect(relocateRow).toBeDefined();
    expect(relocateRow.action).toBe(AuditAction.EDIT);
    expect(relocateRow.entityType).toBe('document');
    expect(relocateRow.entityId).toBe(DOC_ID);
    expect(relocateRow.metadata.from).toBe(from);
    expect(relocateRow.metadata.to).toBe(to);
  });

  it('skips relocate when the document has no linked party', async () => {
    const prisma = buildPrismaStub();
    const audit = buildAuditStub();
    const storage = buildStorageStub();

    prisma.document.findFirst
      .mockResolvedValueOnce({
        id: DOC_ID,
        status: DocumentStatus.NOVO,
        dueDate: null,
        paymentDueDate: null,
        total: null,
        netAmount: null,
      })
      .mockResolvedValueOnce({
        id: DOC_ID,
        fileKey: '<tenant>/_inbox/2026-09-04/orig.pdf',
        pdfKey: null,
        docDate: new Date(),
        docNumber: 'FT 1',
        partyId: null,
        party: null,
      });

    prisma.document.update.mockResolvedValue({ id: DOC_ID, status: DocumentStatus.APROVADO });

    const svc = makeSvc(prisma, audit, storage);
    await svc.approve(TENANT_ID, USER_ID, DOC_ID);

    expect(storage.move).not.toHaveBeenCalled();
    const relocateRow = (audit.log as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((entry: any) => entry.metadata?.subAction === 'storage.relocate');
    expect(relocateRow).toBeUndefined();
  });

  it('skips relocate when the file is already outside _inbox/ (idempotent)', async () => {
    const prisma = buildPrismaStub();
    const audit = buildAuditStub();
    const storage = buildStorageStub();

    prisma.document.findFirst
      .mockResolvedValueOnce({
        id: DOC_ID,
        status: DocumentStatus.NOVO,
        dueDate: null,
        paymentDueDate: null,
        total: null,
        netAmount: null,
      })
      .mockResolvedValueOnce({
        id: DOC_ID,
        fileKey: 'fornecedores/edp/2026-09/already-routed.pdf',
        pdfKey: null,
        docDate: new Date(),
        docNumber: 'FT 1',
        partyId: 'party-1',
        party: {
          id: 'party-1',
          name: 'EDP',
          slug: 'edp',
          type: 'FORNECEDOR',
          partyCategory: null,
        },
      });

    prisma.document.update.mockResolvedValue({ id: DOC_ID, status: DocumentStatus.APROVADO });

    const svc = makeSvc(prisma, audit, storage);
    await svc.approve(TENANT_ID, USER_ID, DOC_ID);

    expect(storage.move).not.toHaveBeenCalled();
  });

  it('also moves the pdfKey sibling when present', async () => {
    const prisma = buildPrismaStub();
    const audit = buildAuditStub();
    const storage = buildStorageStub();

    prisma.document.findFirst
      .mockResolvedValueOnce({
        id: DOC_ID,
        status: DocumentStatus.NOVO,
        dueDate: null,
        paymentDueDate: null,
        total: null,
        netAmount: null,
      })
      .mockResolvedValueOnce({
        id: DOC_ID,
        fileKey: '<tenant>/_inbox/2026-09-04/orig.jpg',
        pdfKey: '<tenant>/_inbox/2026-09-04/orig.pdf',
        docDate: new Date(Date.UTC(2026, 8, 4)),
        docNumber: 'FT 2',
        partyId: 'party-1',
        party: {
          id: 'party-1',
          name: 'AWS',
          slug: 'aws',
          type: 'FORNECEDOR',
          partyCategory: null,
        },
      });

    prisma.document.update.mockResolvedValue({ id: DOC_ID, status: DocumentStatus.APROVADO });

    const svc = makeSvc(prisma, audit, storage);
    await svc.approve(TENANT_ID, USER_ID, DOC_ID);

    expect(storage.move).toHaveBeenCalledTimes(2);
    const [, mainTo] = (storage.move as jest.Mock).mock.calls[0];
    const [, pdfTo] = (storage.move as jest.Mock).mock.calls[1];
    expect(pdfTo).toBe(mainTo.replace(/\.[^.]+$/, '.pdf'));
  });

  it('routes AMBOS parties to fornecedores/ (per product decision)', async () => {
    const prisma = buildPrismaStub();
    const audit = buildAuditStub();
    const storage = buildStorageStub();

    prisma.document.findFirst
      .mockResolvedValueOnce({
        id: DOC_ID,
        status: DocumentStatus.NOVO,
        dueDate: null,
        paymentDueDate: null,
        total: null,
        netAmount: null,
      })
      .mockResolvedValueOnce({
        id: DOC_ID,
        fileKey: '<tenant>/_inbox/2026-09-04/orig.pdf',
        pdfKey: null,
        docDate: new Date(Date.UTC(2026, 8, 4)),
        docNumber: 'FT 3',
        partyId: 'party-2',
        party: {
          id: 'party-2',
          name: 'Grupo Misto',
          slug: 'grupo-misto',
          type: 'AMBOS',
          partyCategory: null,
        },
      });

    prisma.document.update.mockResolvedValue({ id: DOC_ID, status: DocumentStatus.APROVADO });

    const svc = makeSvc(prisma, audit, storage);
    await svc.approve(TENANT_ID, USER_ID, DOC_ID);

    expect(storage.move).toHaveBeenCalledTimes(1);
    const [, to] = (storage.move as jest.Mock).mock.calls[0];
    expect(to).toMatch(/^fornecedores\/grupo-misto\//);
  });
});
