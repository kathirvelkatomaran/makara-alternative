import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';

interface TenantClient {
  client: any;
  lastUsed: number;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  public readonly client: any;
  private tenants = new Map<string, TenantClient>();
  private readonly idleTimeout = 100_000;
  private idleChecker: NodeJS.Timeout | null = null;

  constructor() {
    this.client = this.createClientForSchema('public');
    this.tenants.set('public', { client: this.client, lastUsed: Date.now() });
  }

  forSchema(schema: string): any {
    const s = this.normalize(schema);
    if (this.tenants.has(s)) {
      this.markUsed(s);
      return this.tenants.get(s)!.client;
    }
    const client = this.createClientForSchema(s);
    this.tenants.set(s, { client, lastUsed: Date.now() });
    this.markUsed(s);
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

    const replicaUrls = [
      "postgresql://app:app123@localhost:5434/appdb?application_name=replica1",
      "postgresql://app:app123@localhost:5435/appdb?application_name=replica2",
    ].map(u => this.withSchema(u, schema));

    return base.$extends(readReplicas({ url: replicaUrls }));
  }

  async onModuleInit() {
    await this.client.$connect();
    this.startIdleChecker();
  }

  async onModuleDestroy() {
    this.stopIdleChecker();
    for (const [schema, { client }] of this.tenants.entries()) {
      try {
        await client.$disconnect();
      } catch (err) {
        console.error(`Failed to disconnect ${schema}:`, err);
      }
    }
    this.tenants.clear();
  }


  private startIdleChecker() {
    if (this.idleChecker) return;
    this.idleChecker = setInterval(() => {
      const now = Date.now();
      for (const [schema, { client, lastUsed }] of this.tenants.entries()) {
        if (now - lastUsed > this.idleTimeout) {
          client.$disconnect().catch(() => {});
          this.tenants.delete(schema);
          console.log(`Idle client disconnected: ${schema}`);
        }
      }
    }, 2000);

    this.idleChecker.unref();
  }

  private stopIdleChecker() {
    if (this.idleChecker) {
      clearInterval(this.idleChecker);
      this.idleChecker = null;
    }
  }

  private markUsed(schema: string) {
    const entry = this.tenants.get(this.normalize(schema));
    if (entry) {
      entry.lastUsed = Date.now();
    }
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