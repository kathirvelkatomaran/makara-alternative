// src/prisma/prisma.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { tenantStorage } from '../utils/tenant.middleware';

interface TenantClient {
  base: PrismaClient;
  client: any;
  refCount: number;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public readonly client: PrismaClient;
  private tenants = new Map<string, TenantClient>();

  constructor(@Inject(REQUEST) private readonly request?: Request) {
    this.client = this.createBaseClient('public');
  }

  // PUBLIC: Get current tenant client
  getCurrentClient(): any {
    const schema =
      tenantStorage.getStore() ||
      (this.request?.headers['x-tenant'] as string) ||
      (this.request?.query.tenant as string);

    return schema ? this.forSchema(schema) : this.extendWithReplicas(this.client, 'public');
  }

  // PUBLIC: Get or create client for schema
  forSchema(schema: string): any {
    const s = this.normalize(schema);
    const existing = this.tenants.get(s);
    if (existing) {
      existing.refCount++;
      return existing.client;
    }

    const base = this.createBaseClient(s);
    const extended = this.extendWithReplicas(base, s);
    this.tenants.set(s, { base, client: extended, refCount: 1 });
    this.logger.log(`Created Prisma client for schema: ${s}`);
    return extended;
  }

  // PUBLIC: Normalize schema name
  public normalize(schema?: string): string {
    const s = schema?.trim().toLowerCase();
    return s && s !== 'public' ? s : 'public';
  }


  releaseCurrentTenantClient() {
    const schema = tenantStorage.getStore();
    if (!schema) return;
  
    const tenant = this.tenants.get(schema);
    if (!tenant) return;
  
    tenant.refCount--;
    if (tenant.refCount <= 0) {
      tenant.base
        .$disconnect()
        .then(() => this.logger.debug(`Tenant client "${schema}" disconnected`))
        .catch((e) => this.logger.error(`Failed to disconnect "${schema}": ${e}`));
      this.tenants.delete(schema);
    }
  }

  // PRIVATE: Create base client
  private createBaseClient(schema: string): PrismaClient {
    return new PrismaClient({
      datasources: { db: { url: this.withSchema(process.env.DATABASE_URL!, schema) } },
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'info', 'warn', 'error'],
    });
  }

  // PRIVATE: Add read replicas
  private extendWithReplicas(base: PrismaClient, schema: string): any {
    const replicaUrls = [
      'postgresql://app:app123@localhost:5434/appdb?application_name=replica1',
      'postgresql://app:app123@localhost:5435/appdb?application_name=replica2',
    ].map((u) => this.withSchema(u, schema));

    return base.$extends(readReplicas({ url: replicaUrls }));
  }

  // LIFECYCLE
  async onModuleInit() {
    await this.client.$connect();
    this.logger.log('Master (public) client connected');
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    for (const [s, { base }] of this.tenants) {
      await base.$disconnect().catch(() => {});
    }
    this.tenants.clear();
  }

  // UTILS
  private withSchema(url: string, schema: string): string {
    const u = new URL(url);
    u.searchParams.set('schema', schema);
    return u.toString();
  }
}