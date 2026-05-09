import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.source.upsert({
    where: { slug: '999md' },
    update: {},
    create: {
      slug: '999md',
      name: '999.md',
      baseUrl: 'https://999.md',
      adapterKey: '999md',
      enabled: true,
    },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
