// src/utils/tenant.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaService } from '../prisma/prisma.service';

export const tenantStorage = new AsyncLocalStorage<string>();

// Functional middleware — no @Injectable, no DI
export function TenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const raw =
    (req.headers['x-tenant'] as string) ?? (req.query.tenant as string);

  if (!raw) {
    return res.status(400).json({
      error: 'Missing tenant: x-tenant header or ?tenant query',
    });
  }

  const schema = raw.trim().toLowerCase();
  const normalized = schema === 'public' ? 'public' : schema;

  tenantStorage.run(normalized, () => {
    // Capture PrismaService from global app context
    const prisma = (req as any).prisma as PrismaService;

    const originalEnd = res.end;
    res.end = function (this: Response, ...args: any[]) {
      prisma?.releaseCurrentTenantClient();
      return originalEnd.apply(this, args);
    } as any;

    res.on('finish', () => {
      prisma?.releaseCurrentTenantClient();
    });

    res.on('close', () => {
      prisma?.releaseCurrentTenantClient();
    });

    next();
  });
}