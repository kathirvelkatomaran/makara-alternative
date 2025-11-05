// src/prisma/auto-disconnect.extension.ts
import { Prisma } from '@prisma/client';

export const autoDisconnect = () =>
  Prisma.defineExtension({
    query: {
      async $allOperations({ args, query, operation }) {
        if (operation === '$connect' || operation === '$disconnect') {
          return query(args);
        }

        const result = await query(args);

        // Run disconnect after query
        const prismaService = (global as any)._prismaService;
        if (prismaService) {
          setImmediate(() => {
            prismaService.releaseCurrentTenantClient();
          });
        }

        return result;
      },
    },
  });