import { SupplierResolver } from "./supplier-resolver";

/**
 * In-memory Prisma stub scoped to the models SupplierResolver touches.
 * Mirrors the pattern used in parties.service.spec.ts — the unit tests
 * prove the resolver's logic (lookup → create → recurring bump) without
 * spinning up a real Postgres client.
 */

type PartyRow = {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  nif: string | null;
  iban: string | null;
  country: string;
  isActive: boolean;
  isRecurring: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type DocumentRow = {
  id: string;
  tenantId: string;
  partyId: string | null;
};

const TENANT_ID = "tenant-resolver";

function buildPrismaStub() {
  const dbParties = new Map<string, PartyRow>();
  const dbDocuments = new Map<string, DocumentRow>();
  let partyCounter = 0;
  let docCounter = 0;

  const partyModel = {
    findFirst: jest.fn(async ({ where, select }: any) => {
      for (const p of dbParties.values()) {
        if (
          (!where?.tenantId || p.tenantId === where.tenantId) &&
          (!where?.id || p.id === where.id) &&
          (!where?.nif ||
            (where.nif.contains
              ? (p.nif ?? "").includes(where.nif.contains)
              : p.nif === where.nif)) &&
          (!where?.country || p.country === where.country)
        ) {
          if (select) {
            const out: any = {};
            for (const k of Object.keys(select)) out[k] = (p as any)[k];
            return out;
          }
          return { ...p };
        }
      }
      return null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = `party-${++partyCounter}`;
      const now = new Date();
      const row: PartyRow = {
        id,
        tenantId: data.tenantId,
        type: data.type,
        name: data.name,
        nif: data.nif ?? null,
        iban: data.iban ?? null,
        country: data.country ?? "PT",
        isActive: data.isActive ?? true,
        isRecurring: data.isRecurring ?? false,
        createdAt: now,
        updatedAt: now,
      };
      dbParties.set(id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = dbParties.get(where.id);
      if (!row) throw new Error("party not found");
      Object.assign(row, data);
      row.updatedAt = new Date();
      return { ...row };
    }),
  };

  const documentModel = {
    count: jest.fn(async ({ where }: any) => {
      let n = 0;
      for (const d of dbDocuments.values()) {
        if (
          (!where?.tenantId || d.tenantId === where.tenantId) &&
          (!where?.partyId || d.partyId === where.partyId)
        )
          n++;
      }
      return n;
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = `doc-${++docCounter}`;
      const row: DocumentRow = {
        id,
        tenantId: data.tenantId,
        partyId: data.partyId ?? null,
      };
      dbDocuments.set(id, row);
      return { ...row };
    }),
  };

  return {
    party: partyModel,
    document: documentModel,
    dbParties,
    dbDocuments,
  };
}

describe("SupplierResolver", () => {
  it("creates a new Party on first supplier extraction with high confidence + valid PT NIF", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    const result = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "PT",
      supplierName: "Empresa XPTO",
      supplierNif: "500697256",
      iban: "PT50 0002 0123 1234 5678 9015 4",
      aiConfidence: 0.92,
    });

    // Party was created (no duplicates).
    expect(prisma.dbParties.size).toBe(1);
    const party = Array.from(prisma.dbParties.values())[0];
    expect(party.tenantId).toBe(TENANT_ID);
    expect(party.country).toBe("PT");
    expect(party.nif).toBe("500697256");
    expect(party.isRecurring).toBe(false); // < 3 documents so far
    // Result linked the new party and signed off on it (no review needed).
    expect(result.party?.id).toBe(party.id);
    expect(result.party?.isRecurring).toBe(false);
    expect(result.supplierReview).toBe(false);
    expect(result.reason).toBe("created");
  });

  it("links to the SAME party on a re-upload with the same NIF (no duplicate created)", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    // First upload — creates the Party.
    const first = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "PT",
      supplierName: "Empresa XPTO",
      supplierNif: "500697256",
      aiConfidence: 0.92,
    });
    expect(prisma.dbParties.size).toBe(1);
    expect(prisma.party.create).toHaveBeenCalledTimes(1);

    // Second upload with the same NIF — must NOT create a second Party.
    const second = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "PT",
      supplierName: "Empresa XPTO (outra denominação)",
      supplierNif: "500697256",
      aiConfidence: 0.85,
    });
    expect(prisma.dbParties.size).toBe(1); // still just one party
    expect(prisma.party.create).toHaveBeenCalledTimes(1); // no extra create
    expect(second.party?.id).toBe(first.party?.id);
    expect(second.supplierReview).toBe(false);
    expect(second.reason).toBe("found");
  });

  it("flips isRecurring=true on the third upload for the same NIF", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    // Three uploads of the same supplier. Each call counts documents
    // attached to the party AFTER the link is set, so:
    //   - upload 1 → creates party, docCount=0 → not recurring
    //   - upload 2 → finds party, docCount=1 → not recurring
    //   - upload 3 → finds party, docCount=2 → not recurring (threshold = 3 docs)
    //
    // The Document.count() reads tenant-scoped documents linked to the
    // party. Because the helper itself does NOT create Document rows
    // (the caller — processDocumentAsync — does that after linking),
    // we simulate the side-effect by inserting Document rows in lockstep
    // with each resolver call to mirror the real pipeline.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await resolver.resolve({
        tenantId: TENANT_ID,
        country: "PT",
        supplierName: "Empresa XPTO",
        supplierNif: "500697256",
        aiConfidence: 0.9,
      });
      ids.push(result.party!.id);
      // Mirror what processDocumentAsync does — persist the Document row
      // linked to the resolved party. The resolver reads this count on
      // the NEXT call to decide whether to flip isRecurring.
      await prisma.document.create({
        data: {
          tenantId: TENANT_ID,
          partyId: result.party!.id,
        },
      });
    }

    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    const party = Array.from(prisma.dbParties.values())[0];
    expect(party.isRecurring).toBe(true);
    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: party.id },
        data: { isRecurring: true },
      }),
    );
  });

  it("sets supplierReview=true and still creates the Party when AI confidence < 0.8", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    const result = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "PT",
      supplierName: "Fornecedor Baixa Confiança",
      supplierNif: "500697256", // valid PT NIF — confidence is the gate here
      aiConfidence: 0.6,
    });

    // Party still created — user rule: "EVERY supplier gets a Party".
    expect(prisma.dbParties.size).toBe(1);
    // But the result flagged review because confidence is below the floor.
    expect(result.supplierReview).toBe(true);
    expect(result.reason).toBe("created_review");
  });

  it("sets supplierReview=true and still creates the Party when NIF is invalid (mod-11 fail)", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    const result = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "PT",
      supplierName: "Fornecedor NIF Inválido",
      // 999999999 — starts with 9 (irregular/other) so mod-11 still
      // checks out, but the leading-digit classifier marks it as an
      // irregular NIF and rejects it as a valid supplier identifier.
      supplierNif: "999999999",
      aiConfidence: 0.95,
    });

    expect(prisma.dbParties.size).toBe(1); // still created
    expect(result.supplierReview).toBe(true);
    // Invalid NIFs are stored as null on the row (validator refuses).
    const party = Array.from(prisma.dbParties.values())[0];
    expect(party.nif).toBeNull();
  });

  it("creates a Party with a country-prefixed VAT for foreign suppliers (no PT NIF)", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    const result = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "FR",
      supplierName: "Société Française SARL",
      supplierVatId: "FR12345678901",
      aiConfidence: 0.91,
    });

    expect(prisma.dbParties.size).toBe(1);
    const party = Array.from(prisma.dbParties.values())[0];
    expect(party.country).toBe("FR");
    // The helper stores the VAT as the `nif` column with its country
    // prefix so future lookups can match.
    expect(party.nif).toBe("FR12345678901");
    expect(result.supplierReview).toBe(false);
  });

  it("returns { party: null, supplierReview: true } on DB failure (no crash)", async () => {
    const prisma = buildPrismaStub();
    // Force every Party.create to throw — simulates a transient DB blip.
    prisma.party.create.mockRejectedValue(new Error("simulated db down"));
    // lookupParty also fails on findFirst — keep that working so the
    // helper reaches the create path.
    const resolver = new SupplierResolver(prisma as any);

    const result = await resolver.resolve({
      tenantId: TENANT_ID,
      country: "PT",
      supplierName: "Fornecedor com DB em baixo",
      supplierNif: "500697256",
      aiConfidence: 0.95,
    });

    // MUST NOT throw. MUST surface the failure safely.
    expect(result.party).toBeNull();
    expect(result.supplierReview).toBe(true);
    expect(result.reason).toMatch(/party_create_failed|resolve_threw/);
  });

  it("respects multi-tenant scoping: a party for tenant A is invisible to tenant B", async () => {
    const prisma = buildPrismaStub();
    const resolver = new SupplierResolver(prisma as any);

    // Create on tenant A.
    const a = await resolver.resolve({
      tenantId: "tenant-A",
      country: "PT",
      supplierName: "Fornecedor A",
      supplierNif: "500697256",
      aiConfidence: 0.9,
    });
    expect(a.party?.id).toBeDefined();

    // Tenant B looking up the same NIF must NOT find tenant A's row.
    const b = await resolver.resolve({
      tenantId: "tenant-B",
      country: "PT",
      supplierName: "Fornecedor B",
      supplierNif: "500697256",
      aiConfidence: 0.9,
    });
    expect(b.party?.id).not.toBe(a.party?.id);
    expect(prisma.dbParties.size).toBe(2);
  });
});