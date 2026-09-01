import { PrismaClient } from '@prisma/client';
async function main() {
  const p = new PrismaClient();
  const docs = await p.document.findMany({
    where: { fileName: { in: ['meals.pdf', 'fuel.pdf', 'recurring.pdf', 'foreign.pdf'] } },
    select: { id: true, fileName: true },
  });
  console.log('Will delete:', docs.map((d) => `${d.fileName}=${d.id}`).join('\n  '));
  await p.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  console.log('Deleted', docs.length);
  await p.$disconnect();
}
main().catch(console.error);