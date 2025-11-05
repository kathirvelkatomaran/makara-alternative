
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';
import { config } from 'src/utils/config';

interface TenantClient {
  client: any; 
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  public readonly client: any;

  private tenants = new Map<string, TenantClient>();

  constructor() {
    this.client = this.createClientForSchema('public');
  }

  forSchema(schema: string): any {
    const s = this.normalize(schema);
    if (this.tenants.has(s)) {
      return this.tenants.get(s)!.client;
    }

    const client = this.createClientForSchema(s);
    this.tenants.set(s, { client });
    return client;
  }

  private createClientForSchema(schema: string): any {
    const baseUrl = process.env.DATABASE_URL!;
    const masterUrl = this.withSchema(baseUrl, schema);

    const base = new PrismaClient({
      datasources: { db: { url: masterUrl } },
      log: process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'warn', 'error'],
    });

    const replicaUrls = ["postgresql://app:app123@localhost:5434/appdb?application_name=replica1", "postgresql://app:app123@localhost:5435/appdb?application_name=replica2"].map(u => this.withSchema(u, schema));

    const withReplicas = base.$extends(readReplicas({ url: replicaUrls }));

    return withReplicas;
  }


  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    for (const { client } of this.tenants.values()) {
      await client.$disconnect();
    }
    this.tenants.clear();
  }

  private normalize(schema?: string): string {
    return schema && schema !== 'public' ? schema : 'public';
  }

  private withSchema(url: string, schema: string): string {
    const u = new URL(url);
    u.searchParams.set('schema', schema);
    return u.toString();
  }
}