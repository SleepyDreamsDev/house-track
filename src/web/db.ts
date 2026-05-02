import { PrismaClient } from '@prisma/client';

let instance: PrismaClient | undefined;

export function getPrismaWeb(): PrismaClient {
  if (!instance) {
    instance = new PrismaClient();
  }
  return instance;
}

export async function disconnectPrismaWeb(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
    instance = undefined;
  }
}
