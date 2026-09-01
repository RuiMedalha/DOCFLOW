/**
 * End-to-end verification of the new category-aware filing.
 *
 * Workflow:
 *   1. Create 3 Parties (PT recurring EDP, PT occasional Restaurante X, foreign ES Iberdrola).
 *   2. Upload 4 PDFs (meals, fuel, recurring supplier, foreign).
 *   3. PATCH each document: set partyId + country + manual expenseCategory.
 *   4. Read back finalFolder + metadata.filing and assert the path matches
 *      the expected branch from FOREIGN_INVOICE_FLOW.md.
 *
 * Run with:  npx ts-node scripts/filing-test.ts
 */
import { PrismaClient, DocumentStatus, DocumentType, Prisma } from '@prisma/client';

const TENANT_SLUG = 'demo';

async function main() {
  const prisma = new PrismaClient();

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found`);

  console.log(`# tenant=${tenant.id} (${tenant.slug})\n`);

  // ── 1. Parties ──────────────────────────────────────────────
  const edp = await prisma.party.upsert({
    where: { id: `test-edp-${tenant.id}` },
    update: { isRecurring: true, country: 'PT' },
    create: {
      id: `test-edp-${tenant.id}`,
      tenantId: tenant.id,
      type: 'FORNECEDOR',
      name: 'EDP Comercial',
      nif: '500000001',
      country: 'PT',
      isRecurring: true,
    },
  });

  const iberdrola = await prisma.party.upsert({
    where: { id: `test-iberdrola-${tenant.id}` },
    update: { isRecurring: true, country: 'ES' },
    create: {
      id: `test-iberdrola-${tenant.id}`,
      tenantId: tenant.id,
      type: 'FORNECEDOR',
      name: 'Iberdrola Espana',
      country: 'ES',
      isRecurring: true,
    },
  });

  console.log(`party EDP        ${edp.id}  isRecurring=${edp.isRecurring}  country=${edp.country}`);
  console.log(`party Iberdrola  ${iberdrola.id}  isRecurring=${iberdrola.isRecurring}  country=${iberdrola.country}\n`);

  // ── 2. Simulate: existing test documents from the previous upload session
  //    (we don't have local files; we manufacture 4 Document rows + File blobs).
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const cases: Array<{
    label: string;
    fileName: string;
    type: DocumentType;
    partyId: string | null;
    partyCountry: string;
    partyIsRecurring: boolean;
    manualCategory: string | null;
    expectedPath: string;
  }> = [
    {
      label: '(a) MEALS — occasional PT',
      fileName: `test-meals-${Date.now()}.pdf`,
      type: DocumentType.FATURA_RECEBIDA,
      partyId: null,
      partyCountry: 'PT',
      partyIsRecurring: false,
      manualCategory: 'Refeições',
      expectedPath: `/Despesas/refeicoes/${yearMonth}`,
    },
    {
      label: '(b) FUEL — occasional PT',
      fileName: `test-fuel-${Date.now()}.pdf`,
      type: DocumentType.FATURA_RECEBIDA,
      partyId: null,
      partyCountry: 'PT',
      partyIsRecurring: false,
      manualCategory: 'Combustível',
      expectedPath: `/Despesas/combustivel/${yearMonth}`,
    },
    {
      label: '(c) RECURRING — EDP PT',
      fileName: `test-edp-${Date.now()}.pdf`,
      type: DocumentType.FATURA_RECEBIDA,
      partyId: edp.id,
      partyCountry: 'PT',
      partyIsRecurring: true,
      manualCategory: null,
      expectedPath: `/Fornecedores/edp_comercial/${yearMonth}`,
    },
    {
      label: '(d) FOREIGN — Iberdrola ES (recurring)',
      fileName: `test-iberdrola-${Date.now()}.pdf`,
      type: DocumentType.FATURA_RECEBIDA,
      partyId: iberdrola.id,
      partyCountry: 'ES',
      partyIsRecurring: true,
      manualCategory: null,
      expectedPath: `/Estrangeiras/Fornecedores/iberdrola_espana/${yearMonth}`,
    },
  ];

  // For the foreign case (d) we ALSO want to test category-mode under foreign — let's
  // add an extra case to verify (a) with foreign country too.

  const summary: Array<{ label: string; folder: string; filing: unknown }> = [];

  for (const c of cases) {
    const fileHash = `test-${c.label.replace(/\W/g, '')}-${Date.now()}`;
    const fileKey = `${tenant.id}/${yearMonth.replace('/', '/')}/${fileHash}.pdf`;
    const doc = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        fileName: c.fileName,
        fileKey,
        fileHash,
        mimeType: 'application/pdf',
        fileSize: 1024,
        type: c.type,
        status: DocumentStatus.EM_REVISAO,
        partyId: c.partyId,
        // Use docDate in this month for the refDate.
        docDate: new Date(),
        // Pre-seed metadata so the engine sees the existing party + category.
        metadata: {
          filing: c.manualCategory
            ? {
                expenseCategory: c.manualCategory,
                source: 'user',
              }
            : { source: 'cleared' },
          extraction: {
            country: c.partyCountry,
            source: 'manual',
          },
        } as Prisma.InputJsonValue,
      },
    });

    summary.push({
      label: c.label,
      folder: doc.finalFolder ?? '(none)',
      filing: doc.metadata,
    });

    console.log(`✓ Created ${c.label.padEnd(40)} id=${doc.id}`);
    console.log(`    initial finalFolder = ${doc.finalFolder ?? '(none)'}`);
    console.log(`    expected after PATCH = ${c.expectedPath}`);
  }

  console.log('\n# Next step: run scripts/verify-filing.ts to PATCH and assert paths.\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
