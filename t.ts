// src/prisma/prisma.service.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

interface TenantClients {
  write: PrismaClient;    // primary (tenant-scoped)
  replica?: PrismaClient; // write client extended with $replica() / $primary()
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly base = new PrismaClient();
  private tenants = new Map<string, TenantClients>();

  // Back-compat: public schema primary
  get client(): PrismaClient {
    return this.clientForWrite('public');
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
    const pubWrite = this.clientForWrite('public');
    await pubWrite.$connect();
    const pubReplica = this.getReplicaClient('public');
    if (pubReplica) await pubReplica.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    for (const { write, replica } of this.tenants.values()) {
      await write.$disconnect();
      if (replica) await replica.$disconnect();
    }
    await this.base.$disconnect();
    this.tenants.clear();
  }

  // ---------------- Public API ----------------

  /** Primary (WRITE) client for a tenant */
  clientForWrite(schema: string): PrismaClient {
    const s = this.normalize(schema);
    const existing = this.tenants.get(s);
    if (existing) return existing.write;

    // Tenant-scoped primary (force search_path via libpq options)
    const writeUrl = this.withSearchPath(process.env.DATABASE_URL!, s);
    const write = new PrismaClient({
      datasources: { db: { url: writeUrl } },
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'warn', 'error'],
    });

    const tenant: TenantClients = { write };

    // Replica(s): extend the WRITE client; each URL also gets tenant search_path
    const replicaUrls = ["postgresql://app:app123@localhost:5434/appdb?application_name=replica1", "postgresql://app:app123@localhost:5435/appdb?application_name=replica2"].map(u => this.withSearchPath(u, s));
    if (replicaUrls.length) {
      const replicaExtended = write.$extends(readReplicas({ url: replicaUrls }));
      tenant.replica = replicaExtended as unknown as PrismaClient;
    }

    this.tenants.set(s, tenant);
    this.logger.log(`Prisma clients ready for schema "${s}"`);
    return write;
  }

  /** Read client that routes SELECTs to a replica when available; else primary */
  clientForRead(schema: string): PrismaClient {
    const r = this.getReplicaClient(schema);
    return r ? (r as any).$replica() : this.clientForWrite(schema);
  }

  /** Replica-aware client (has $replica() / $primary()) */
  getReplicaClient(schema: string): PrismaClient | undefined {
    const s = this.normalize(schema);
    return this.tenants.get(s)?.replica;
  }

  /**
   * Run a callback in a transaction with tenant search_path set.
   * Works with PgBouncer (transaction pooling) because we use SET LOCAL.
   */
  async withTenant<T>(
    schema: string,
    opts: { read?: boolean } = {},
    cb: (db: TxClient) => Promise<T>,
  ): Promise<T> {
    const base = opts.read ? this.clientForRead(schema) : this.clientForWrite(schema);
    const s = this.normalize(schema);
    return base.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path = ${this.pgId(s)}, public`);
      return cb(tx);
    });
  }

  /** Create tenant schema if missing */
  async ensureSchema(schema: string): Promise<void> {
    const s = this.normalize(schema);
    if (s === 'public') return;
    await this.base.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${this.pgId(s)}`);
  }

  // ---------------- Internals ----------------

  private normalize(schema?: string): string {
    return schema && schema !== 'public' ? schema : 'public';
  }

  /** Quote only when needed; escape embedded quotes */
  private pgId(schema: string): string {
    return /^[a-z_][a-z0-9_]*$/.test(schema)
      ? schema
      : `"${schema.replace(/"/g, '""')}"`;
  }

  /** Force Postgres search_path via libpq "options" param (primary & replicas) */
  private withSearchPath(urlStr: string, schema: string): string {
    const u = new URL(urlStr);
    const sp = `${this.pgId(schema)},public`;
    const opt = `-c search_path=${sp}`;
    const existing = u.searchParams.get('options');
    u.searchParams.set('options', existing ? `${existing} ${opt}` : opt);
    // Prisma's '?schema' is not used for Postgres; remove to avoid confusion
    u.searchParams.delete('schema');
    return u.toString();
  }

  /**
   * REPLICA_URLS from env:
   *  CSV:  REPLICA_URLS=postgres://rep1,...,postgres://repN
   *  JSON: REPLICA_URLS=["postgres://rep1","postgres://rep2"]
   */
  private parseReplicaUrls(): string[] {
    const raw = process.env.REPLICA_URLS ?? '';
    try {
      if (!raw.trim()) return [];
      if (raw.trim().startsWith('[')) return (JSON.parse(raw) as string[]).filter(Boolean);
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    } catch (e) {
      this.logger.warn('Failed to parse REPLICA_URLS; ignoring. ' + (e as Error).message);
      return [];
    }
  }
}
