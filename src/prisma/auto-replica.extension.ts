// src/prisma/auto-replica.extension.ts
import { Prisma } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';

/**
 * Returns a Prisma extension that:
 *   • reads → replica
 *   • writes → primary (master)
 */
export const autoReadReplicas = (replicaUrls: string[]) =>
  Prisma.defineExtension((client) => {
    // 1. apply the official read-replicas extension
    const withReplicas = client.$extends(readReplicas({ url: replicaUrls }));

    const writeOps = new Set([
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
      'executeRaw',
      'executeRawUnsafe',
    ]);

    // 2. Proxy every model (user, post, …)
    return new Proxy(withReplicas, {
      get(target, model) {
        const value = Reflect.get(target, model);
        if (typeof value === 'object' && value !== null) {
          return new Proxy(value, {
            get(actionTarget, action) {
              const fn = Reflect.get(actionTarget, action);
              if (typeof fn === 'function') {
                return function (...args: any[]) {
                  const isWrite = writeOps.has(action as string);
                  const db = isWrite ? target.$primary() : target.$replica();
                  return (db as any)[model][action](...args);
                };
              }
              return fn;
            },
          });
        }
        return value;
      },
    });
  });