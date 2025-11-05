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
import { tenantStorage } from '../utils/tenant.storage';
import { autoReadReplicas } from './auto-replica.extension';
import { autoDisconnect } from './auto-disconnect.extension';

interface TenantClient {
  base: PrismaClient;
  client: any;
  refCount: number;
}

// src/prisma/prisma.service.ts
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly masterClient: PrismaClient;
  private tenants = new Map<string, TenantClient>();

  constructor(@Inject(REQUEST) private readonly request?: Request) {
    this.masterClient = this.createBaseClient('public');
    (global as any)._prismaService = this;
  }


  get client(): any {
    const schema = tenantStorage.getStore() || 'public';
    const s = this.normalize(schema);
  
    let tenant = this.tenants.get(s);
    if (!tenant) {
      const base = this.createBaseClient(s);
      const extended = this.extendWithReplicas(base, s);
      tenant = { base, client: extended, refCount: 0 };
      this.tenants.set(s, tenant);
    }
  
    tenant.refCount++;
    return tenant.client;
  }
  
  public normalize(schema?: string): string {
    const s = schema?.trim().toLowerCase();
    return s && s !== 'public' ? s : 'public';
  }

  public releaseCurrentTenantClient() {
    const schema = tenantStorage.getStore();
    if (!schema) return;

    const tenant = this.tenants.get(schema);
    if (!tenant) return;

    tenant.refCount--;
    this.logger.debug(`refCount[${schema}]: ${tenant.refCount}`);

    if (tenant.refCount <= 0) {
      tenant.base.$disconnect().catch(() => {});
      this.tenants.delete(schema);
      this.logger.debug(`Disconnected: ${schema}`);
    }
  }
  
  public forSchema(schema: string): any {
    const s = this.normalize(schema);
    let tenant = this.tenants.get(s);
    if (!tenant) {
      const base = this.createBaseClient(s);
      const extended = this.extendWithReplicas(base, s);
      tenant = { base, client: extended, refCount: 0 };
      this.tenants.set(s, tenant);
      this.logger.log(`Created tenant client: ${s}`);
    }
    return tenant.client;
  }
  private createBaseClient(schema: string): PrismaClient {
    return new PrismaClient({
      datasources: { db: { url: this.withSchema(process.env.DATABASE_URL!, schema) } },
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'info', 'warn', 'error'],
    });
  }

  private extendWithReplicas(base: PrismaClient, schema: string): any {
    const replicaUrls = [
      'postgresql://app:app123@localhost:5434/appdb?application_name=replica1',
      'postgresql://app:app123@localhost:5435/appdb?application_name=replica2',
    ].map(u => this.withSchema(u, schema));

    return base
      .$extends(readReplicas({ url: replicaUrls }))
      .$extends(autoReadReplicas(replicaUrls))
      .$extends(autoDisconnect());
  }

  async onModuleInit() {
    await this.masterClient.$connect();
  }

  async onModuleDestroy() {
    await this.masterClient.$disconnect();
    for (const [s, { base }] of this.tenants) {
      await base.$disconnect().catch(() => { });
    }
    this.tenants.clear();
  }

  private withSchema(url: string, schema: string): string {
    const u = new URL(url);
    u.searchParams.set('schema', schema);
    return u.toString();
  }
}