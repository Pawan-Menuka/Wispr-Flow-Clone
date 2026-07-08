import { PrismaClient } from '@prisma/client';

/** Single PrismaClient per process (Prisma pools internally). */
let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}
