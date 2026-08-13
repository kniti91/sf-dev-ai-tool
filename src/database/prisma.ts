import { PrismaPg } from '@prisma/adapter-pg'
import { config } from '../config.js'
import { PrismaClient } from '../generated/prisma/client.js'

const adapter = new PrismaPg({ connectionString: config.DATABASE_URL })

export const prisma = new PrismaClient({ adapter })

export async function checkDatabase() {
  await prisma.$queryRaw`SELECT 1`
}

export async function disconnectDatabase() {
  await prisma.$disconnect()
}
