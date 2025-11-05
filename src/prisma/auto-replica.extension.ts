// src/prisma/auto-replica.extension.ts
import { Prisma } from '@prisma/client';

export const autoReadReplicas = (replicaUrls: string[]) =>
  Prisma.defineExtension((client: any) => {
    return client.$extends({
      query: {
        $allModels: {
          async $allOperations({ operation, model, args, query }) {
            const writeOps = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];
            const isWrite = writeOps.includes(operation);
            const target = isWrite ? client.$primary() : client.$replica();
            return (target as any)[model][operation](args);
          },
        },
      },
    });
  });