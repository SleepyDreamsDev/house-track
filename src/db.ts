import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prismaClient) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    prismaClient = new PrismaClient({ datasources: { db: { url } } });
  }
  return prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = undefined;
  }
}
