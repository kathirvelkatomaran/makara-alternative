// src/prisma/prisma.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';
import { config } from 'src/utils/config';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type ReplicaClient = ReturnType<typeof readReplicas> & {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  read(): any;
  write(): any;
};

interface TenantClients {
  write: PrismaClient;
  read?: ReplicaClient;
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private tenants = new Map<string, TenantClients>();
  private readonly base: PrismaClient;

  constructor() {
    this.base = new PrismaClient({
      log: process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'info', 'warn', 'error'],
    });
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------
  get client(): PrismaClient {
    return this.tenant('public');
  }

  /** Returns the *write* client (primary) */
  tenant(schema: string): PrismaClient {
    const normalized = schema && schema !== 'public' ? schema : 'public';

    if (this.tenants.has(normalized)) {
      return this.tenants.get(normalized)!.write;
    }

    // ------------------- WRITE (primary) -------------------
    const writeUrl = new URL(process.env.DATABASE_URL!);
    writeUrl.searchParams.set('search_path', `${normalized},public`);

    const write = new PrismaClient({
      datasources: { db: { url: writeUrl.toString() } },
      log: process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'info', 'warn', 'error'],
    });

    const tenant: TenantClients = { write };

    // ------------------- READ REPLICAS -------------------
    const rawReplicaUrls = [
      "postgresql://app:app123@localhost:5434/appdb?application_name=replica1",
      "postgresql://app:app123@localhost:5435/appdb?application_name=replica2"
    ];
    // this.parseReplicaUrls();

    if (rawReplicaUrls.length > 0) {
      const replicaUrls = rawReplicaUrls.map((u) => {
        const url = new URL(u);
        url.searchParams.set('search_path', `${normalized},public`);
        return url.toString();
      });

      const readBase = new PrismaClient({
        datasources: { db: { url: replicaUrls[0] } },
        log: ['error'],
      });

      // Correct type: readReplicas returns an extension
      const readExt = readReplicas({
        url: replicaUrls.slice(1),
      });

      // Apply it
      const read = readBase.$extends(readExt) as unknown as ReplicaClient;

      tenant.read = read;
    }

    this.tenants.set(normalized, tenant);
    this.logger.log(`Created Prisma client for schema "${normalized}"`);
    return write;
  }

  /** Get the *replica* client (with .read() / .write()) */
  getReadClient(schema: string): ReplicaClient | undefined {
    const normalized = schema && schema !== 'public' ? schema : 'public';
    return this.tenants.get(normalized)?.read;
  }

  // -----------------------------------------------------------------
  // Schema helper
  // -----------------------------------------------------------------
  async ensureSchema(schema: string): Promise<void> {
    if (!schema || schema === 'public') return;
    await this.base.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  }

  // -----------------------------------------------------------------
  // Replica parsing
  // -----------------------------------------------------------------
  private parseReplicaUrls(): string[] {
    try {
      let raw = config.replicas;
      if (typeof raw === 'string') {
        raw = raw.trim();
        if (
          (raw.startsWith('[') && raw.endsWith(']')) ||
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
        ) {
          raw = raw.slice(1, -1).trim();
        }
        return raw
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      console.error('Failed to parse REPLICA_URLS:', err);
      return [];
    }
  }

  // -----------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------
  async onModuleInit(): Promise<void> {
    await this.base.$connect();
    this.tenant('public');
  }

  async onModuleDestroy(): Promise<void> {
    for (const { write, read } of this.tenants.values()) {
      await write.$disconnect();
      if (read) await read.$disconnect();
    }
    await this.base.$disconnect();
    this.tenants.clear();
  }
}


// // src/prisma/prisma.service.ts
// import {
//   Injectable,
//   OnModuleInit,
//   OnModuleDestroy,
//   Logger,
// } from '@nestjs/common';
// import { Prisma, PrismaClient } from '@prisma/client';
// import { readReplicas } from '@prisma/extension-read-replicas';
// import { config } from 'src/utils/config';

// interface TenantClient {
//   /** Full Prisma client that talks to a specific schema */
//   write: PrismaClient;
//   /** Optional read-replica client (same schema) */
//   read?: PrismaClient;
// }

// @Injectable()
// export class PrismaService implements OnModuleInit, OnModuleDestroy {
//   private readonly logger = new Logger(PrismaService.name);

//   /** Map<schemaName, {write, read?}> */
//   private tenants = new Map<string, TenantClient>();

//   /** Base client used for DDL (public schema) */
//   private readonly base: PrismaClient;

//   constructor() {
//     // -----------------------------------------------------------------
//     // 1. Base client (public schema) – used for migrations / DDL
//     // -----------------------------------------------------------------
//     this.base = new PrismaClient({
//       log:
//         process.env.NODE_ENV === 'production'
//           ? ['error']
//           : ['query', 'info', 'warn', 'error'],
//     });

//     // -----------------------------------------------------------------
//     // 2. Attach read-replicas to the base client (optional)
//     // -----------------------------------------------------------------
//     const replicaUrls = this.parseReplicaUrls();
//     if (replicaUrls.length) {
//       this.base.$extends(readReplicas({ url: replicaUrls }));
//     }
//   }



//   get client(): PrismaClient {
//     return this.tenant('public');
//   }

//   tenant(schema: string): PrismaClient {
//     const normalized = schema && schema !== 'public' ? schema : 'public';
  
//     if (this.tenants.has(normalized)) {
//       return this.tenants.get(normalized)!.write;
//     }
  
//     // --- WRITE CLIENT (primary) ---
//     const writeUrl = new URL(process.env.DATABASE_URL!);
//     writeUrl.searchParams.set('search_path', `${normalized},public`);
  
//     const write = new PrismaClient({
//       datasources: { db: { url: writeUrl.toString() } },
//       log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'info', 'warn', 'error'],
//     });
  
//     const tenant: TenantClient = { write };
  
//     // --- READ REPLICAS ---
//     const rawReplicaUrls = this.parseReplicaUrls();
  
//     if (rawReplicaUrls.length > 0) {
//       const replicaUrls = rawReplicaUrls.map((u) => {
//         const url = new URL(u);
//         url.searchParams.set('search_path', `${normalized},public`);
//         return url.toString();
//       });
  
//       // 1. Base client with first replica
//       const readBase = new PrismaClient({
//         datasources: { db: { url: replicaUrls[0] } },
//         log: ['error'],
//       });
  
//       // 2. Extend with readReplicas()
//       const readClient = readBase.$extends(
//         readReplicas({
//           url: replicaUrls.slice(1), // skip first
//         })
//       );
  
//       // 3. Attach to tenant
//       tenant.read = readClient;
//     }
  
//     this.tenants.set(normalized, tenant);
//     this.logger.log(`Created Prisma client for schema "${normalized}"`);
//     return write;
//   }

//   // tenant(schema: string): PrismaClient {
//   //   const normalized = schema && schema !== 'public' ? schema : 'public';
  
//   //   // ---- CACHE HIT ----
//   //   if (this.tenants.has(normalized)) {
//   //     return this.tenants.get(normalized)!.write;
//   //   }
  
//   //   // ---- PRIMARY (WRITE) CLIENT ----
//   //   const writeUrl = new URL(process.env.DATABASE_URL!);
//   //   writeUrl.searchParams.set('schema', normalized);
  
//   //   const write = new PrismaClient({
//   //     datasources: { db: { url: writeUrl.toString() } },
//   //     log:
//   //       process.env.NODE_ENV === 'production'
//   //         ? ['error']
//   //         : ['query', 'info', 'warn', 'error'],
//   //   });
  
//   //   const tenant: TenantClient = { write };
  
//   //   // ---- READ REPLICAS (NATIVE ARRAY + MIDDLEWARE) ----
//   //   const rawReplicaUrls = [
//   //     "postgresql://app:app123@localhost:5434/appdb?application_name=replica1",
//   //     "postgresql://app:app123@localhost:5435/appdb?application_name=replica2"
//   //   ]
  
//   //   if (rawReplicaUrls.length > 0) {
//   //     const replicaUrls = rawReplicaUrls.map((u) => {
//   //       const url = new URL(u);
//   //       url.searchParams.set('schema', normalized);
//   //       return url.toString();
//   //     });
  
//   //     const read = new PrismaClient({
//   //       datasources: {
//   //         db: {
//   //           url: replicaUrls.join(','), // Prisma handles round-robin
//   //         },
//   //       },
//   //       log: ['error'],
//   //     });
  
//   //     // APPLY MIDDLEWARE (TYPE-SAFE!)
//   //     read.$use(async (params, next) => {
//   //       // Inject search_path for every query
//   //       const setSearchPath = Prisma.sql`SET LOCAL search_path TO ${Prisma.sql([normalized])}, public`;
//   //       await read.$executeRaw(setSearchPath);
//   //       return next(params);
//   //     });
  
//   //     tenant.read = read; // 100% PrismaClient – no TS error
//   //   }
  
//   //   this.tenants.set(normalized, tenant);
//   //   this.logger.log(`Created Prisma client for schema "${normalized}"`);
//   //   return write;
//   // }

//   // tenant(schema: string): PrismaClient {
//   //   const normalized = schema && schema !== 'public' ? schema : 'public';

//   //   // if (this.tenants.has(normalized)) {
//   //   //   return this.tenants.get(normalized)!.write;
//   //   // }

//   //   const url = new URL(process.env.DATABASE_URL!);
//   //   url.searchParams.set('schema', normalized);

//   //   const write = new PrismaClient({
//   //     datasources: { db: { url: url.toString() } },
//   //     log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'info', 'warn', 'error'],
//   //   });

//   //   const tenant: TenantClient = { write };

//   //   // --- READ REPLICAS ---
//   //   const replicaUrls = [
//   //     "postgresql://app:app123@localhost:5434/appdb?application_name=replica1",
//   //     "postgresql://app:app123@localhost:5435/appdb?application_name=replica2"
//   //   ] 
//   //   // from config
//   //   if (replicaUrls.length) {
//   //     const readUrl = new URL(replicaUrls[0]);
//   //     readUrl.searchParams.set('schema', normalized);
//   //     const read = new PrismaClient({
//   //       datasources: { db: { url: readUrl.toString() } },
//   //       log: ['error'],
//   //     });
//   //     if (replicaUrls.length > 1) {
//   //       read.$extends(readReplicas({
//   //         url: replicaUrls.slice(1).map(u => {
//   //           const uu = new URL(u);
//   //           uu.searchParams.set('schema', normalized);
//   //           return uu.toString();
//   //         })
//   //       }));
//   //     }
//   //     tenant.read = read;
//   //   }

//   //   this.tenants.set(normalized, tenant);
//   //   this.logger.log(`Created Prisma client for schema "${normalized}"`);

//   //   // --- AUTO-CREATE TABLES ---
//   //   // this.createTablesIfMissing(normalized, write).catch(err =>
//   //   //   this.logger.error(`Failed to init schema ${normalized}`, err)
//   //   // );

//   //   return write;
//   // }

//   // -----------------------------------------------------------------
//   // Helper: ensure a schema exists (run once per tenant)
//   // -----------------------------------------------------------------
//   async ensureSchema(schema: string): Promise<void> {
//     if (!schema || schema === 'public') return;
//     await this.base.$executeRawUnsafe(
//       `CREATE SCHEMA IF NOT EXISTS "${schema}"`,
//     );
//   }

//   parseReplicaUrls() {
//     try {
//       let raw = config.replicas;
//       if (typeof raw === 'string') {
//         raw = raw.trim();
//         if ((raw.startsWith('[') && raw.endsWith(']')) ||
//           (raw.startsWith('"') && raw.endsWith('"')) ||
//           (raw.startsWith("'") && raw.endsWith("'"))) {
//           raw = raw.slice(1, -1).trim();
//         }
//         return raw
//           .split(',')
//           .map(s => s.trim().replace(/^["']|["']$/g, ''))
//           .filter(Boolean);
//       }
//       return Array.isArray(raw) ? raw : [];
//     } catch (err) {
//       console.error('Failed to parse REPLICA_URLS:', err);
//       return [];
//     }
//   }

//   async onModuleInit(): Promise<void> {
//     await this.base.$connect();

//     this.tenant('public');
//   }
//   async onModuleDestroy(): Promise<void> {
//     for (const { write, read } of this.tenants.values()) {
//       await write.$disconnect();
//       if (read) await read.$disconnect();
//     }
//     await this.base.$disconnect();
//     this.tenants.clear();
//   }

// }

// import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// import { PrismaClient } from '@prisma/client';
// import { readReplicas } from '@prisma/extension-read-replicas';
// import { config } from 'src/utils/config';

// @Injectable()
// export class PrismaService implements OnModuleInit, OnModuleDestroy {
//   public readonly client: any;

//   constructor() {
//     // FIXED: Removed "Toggle" typo
//     const base = new PrismaClient({
//       log: process.env.NODE_ENV === 'production'
//         ? ['error']
//         : ['query', 'warn', 'error'],
//     });

//     const replicaUrls = this.parseReplicaUrls();
//     const withReplicas = base.$extends(readReplicas({ url: replicaUrls }));

//     // FINAL MIDDLEWARE: Use model.$executeRaw (model IS the client instance)
//     const withSearchPath = withReplicas.$extends({
//       query: {
//         $allModels: {
//           async $allOperations({ args, query, model, operation }) {
//             const schema = (global as any).CURRENT_SCHEMA || 'public';

//             return this.$transaction(async (tx) => {
//               await tx.$executeRaw`SET LOCAL search_path TO ${schema}, public`;
//               return tx[model][operation](args);
//             });
//           },
//         },
//       },
//     });

//     this.client = withSearchPath;
//   }

//   parseReplicaUrls() {
//     try {
//       let raw = config.replicas;
//       if (typeof raw === 'string') {
//         raw = raw.trim();
//         if ((raw.startsWith('[') && raw.endsWith(']')) ||
//             (raw.startsWith('"') && raw.endsWith('"')) ||
//             (raw.startsWith("'") && raw.endsWith("'"))) {
//           raw = raw.slice(1, -1).trim();
//         }
//         return raw
//           .split(',')
//           .map(s => s.trim().replace(/^["']|["']$/g, ''))
//           .filter(Boolean);
//       }
//       return Array.isArray(raw) ? raw : [];
//     } catch (err) {
//       console.error('Failed to parse REPLICA_URLS:', err);
//       return [];
//     }
//   }

//   async onModuleInit() {
//     await this.client.$connect();
//   }

//   async onModuleDestroy() {
//     await this.client.$disconnect();
//   }

//   async whoAmI() {
//     const [row] = await this.client.$queryRaw`
//       SELECT current_schema() AS schema, inet_server_port() AS port
//     `;
//     console.log(`[DB] ${row.schema} → PORT: ${row.port}`);
//     return row;
//   }
// }