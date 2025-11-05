// src/tenants/tenants.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new tenant schema and sync all public tables
   */
  async createTenant(schemaName: string): Promise<void> {
    const safeSchema = schemaName.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeSchema) throw new Error('Invalid schema name');

    // 1. Create schema
    await this.prisma.client.$executeRaw`
      CREATE SCHEMA IF NOT EXISTS ${Prisma.raw(safeSchema)};
    `;

    // 2. Get all table names from public
    const tables: Array<{ table_name: string }> = await this.prisma.client.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE';
    `;

    // 3. Clone each table (structure + indexes + constraints)
    for (const { table_name } of tables) {
      await this.prisma.client.$executeRaw`
        CREATE TABLE IF NOT EXISTS ${Prisma.raw(safeSchema)}."${Prisma.raw(table_name)}" 
        (LIKE public."${Prisma.raw(table_name)}" INCLUDING ALL);
      `;
    }

    console.log(`Tenant schema '${safeSchema}' created and synced.`);
  }

  
  /**
   * Optional: Sync existing tenant with public (run on deploy)
   */
  async syncTenant(schemaName: string): Promise<void> {
    const safeSchema = schemaName.replace(/[^a-zA-Z0-9_]/g, '');
    const result: Array<{ exists: boolean }> = await this.prisma.client.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = ${safeSchema}
      ) AS exists;
    `;

    if (!result[0].exists) {
      throw new Error(`Schema '${safeSchema}' does not exist`);
    }

    const tables: Array<{ table_name: string }> = await this.prisma.client.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE';
    `;

    for (const { table_name } of tables) {
      // Drop and recreate to ensure sync
      await this.prisma.client.$executeRaw`
        DROP TABLE IF EXISTS ${Prisma.raw(safeSchema)}."${Prisma.raw(table_name)}";
        CREATE TABLE ${Prisma.raw(safeSchema)}."${Prisma.raw(table_name)}" 
        (LIKE public."${Prisma.raw(table_name)}" INCLUDING ALL);
      `;
    }

    console.log(`Tenant '${safeSchema}' synced with public.`);
  }
}