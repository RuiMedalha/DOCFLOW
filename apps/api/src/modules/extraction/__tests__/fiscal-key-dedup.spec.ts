import { ExtractionService } from "../extraction.service";

/**
 * Fase 3 — duplicate detection by fiscal key. The original is the oldest
 * live row with the same (tenant, supplier NIF, normalised number); when
 * both rows carry an ATCUD they must match. Rows already DUPLICADO or
 * soft-deleted are excluded by the query itself (asserted on the `where`).
 */
function svcWith(rows: Array<{ id: string; fileName: string; atcud: string | null }>) {
  const findMany = jest.fn(async () => rows);
  const svc = new ExtractionService({ document: { findMany } } as any, null, null);
  return { svc, findMany };
}

describe("ExtractionService.findFiscalKeyOriginal() — Fase 3", () => {
  it("returns the oldest live match and scopes the query to the tenant + fiscal key", async () => {
    const { svc, findMany } = svcWith([{ id: "orig", fileName: "a.pdf", atcud: null }]);
    const out = await svc.findFiscalKeyOriginal("t1", "new", "500842019", "2026A926384", null);
    expect(out).toEqual({ id: "orig", fileName: "a.pdf" });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: "t1",
      supplierNif: "500842019",
      docNumberNorm: "2026A926384",
      deletedAt: null,
      id: { not: "new" },
      status: { not: "DUPLICADO" },
    });
  });

  it("matches when ATCUDs agree and skips rows whose ATCUD differs", async () => {
    const { svc } = svcWith([
      { id: "other-series", fileName: "x.pdf", atcud: "AAAA1111-6384" },
      { id: "same", fileName: "y.pdf", atcud: "J66V9C9T-6384" },
    ]);
    const out = await svc.findFiscalKeyOriginal("t1", "new", "500842019", "2026A926384", "J66V9C9T-6384");
    expect(out?.id).toBe("same");
  });

  it("a row without ATCUD (scan read by AI) still matches a certified original", async () => {
    const { svc } = svcWith([{ id: "orig", fileName: "a.pdf", atcud: "J66V9C9T-6384" }]);
    const out = await svc.findFiscalKeyOriginal("t1", "new", "500842019", "2026A926384", null);
    expect(out?.id).toBe("orig");
  });

  it("returns null when nothing matches, when prisma has no findMany (test doubles) or when the query throws", async () => {
    expect(await svcWith([]).svc.findFiscalKeyOriginal("t1", "n", "1", "2", null)).toBeNull();
    const noFinder = new ExtractionService({ document: {} } as any, null, null);
    expect(await noFinder.findFiscalKeyOriginal("t1", "n", "1", "2", null)).toBeNull();
    const throwing = new ExtractionService(
      { document: { findMany: jest.fn(async () => { throw new Error("db down"); }) } } as any,
      null,
      null,
    );
    expect(await throwing.findFiscalKeyOriginal("t1", "n", "1", "2", null)).toBeNull();
  });
});
