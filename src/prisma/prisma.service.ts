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
import { autoReadReplicas } from './auto-replica.extension';

interface TenantClient {
  base: PrismaClient;
  client: any;
  refCount: number;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly masterClient: PrismaClient; // real master
  private tenants = new Map<string, TenantClient>();

  constructor(@Inject(REQUEST) private readonly request?: Request) {
    this.masterClient = this.createBaseClient('public');
  }

  // GETTER: Dynamically returns tenant client or master
  get client(): any {
    const schema =
      tenantStorage.getStore() ||
      (this.request?.headers['x-tenant'] as string) ||
      (this.request?.query.tenant as string);

    if (!schema) return this.extendWithReplicas(this.masterClient, 'public');

    const s = this.normalize(schema);
    const existing = this.tenants.get(s);
    if (existing) {
      existing.refCount++;
      return existing.client;
    }

    const base = this.createBaseClient(s);
    const extended = this.extendWithReplicas(base, s);
    this.tenants.set(s, { base, client: extended, refCount: 1 });
    this.logger.log(`Created tenant client: ${s}`);
    return extended;
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
    if (tenant.refCount <= 0) {
      tenant.base.$disconnect().catch(() => {});
      this.tenants.delete(schema);
      this.logger.debug(`Disconnected tenant: ${schema}`);
    }
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
      .$extends(autoReadReplicas(replicaUrls));
  }

  async onModuleInit() {
    await this.masterClient.$connect();
  }

  async onModuleDestroy() {
    await this.masterClient.$disconnect();
    for (const [s, { base }] of this.tenants) {
      await base.$disconnect().catch(() => {});
    }
    this.tenants.clear();
  }

  private withSchema(url: string, schema: string): string {
    const u = new URL(url);
    u.searchParams.set('schema', schema);
    return u.toString();
  }
}