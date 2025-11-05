import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { tenantStorage } from './tenant.storage';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const raw = (req.headers['x-tenant'] as string) ?? (req.query.tenant as string);
    if (!raw) {
      return res.status(400).json({ error: 'Missing x-tenant' });
    }

    const schema = raw.trim().toLowerCase() === 'public' ? 'public' : raw.trim().toLowerCase();

    tenantStorage.run(schema, () => {
      const client = this.prisma.client; // Access to ensure tenant client is created

      let disconnected = false;
      const disconnect = () => {
        if (!disconnected) {
          disconnected = true;
          this.prisma.releaseCurrentTenantClient();
        }
      };

      res.on('finish', disconnect);
      res.on('close', disconnect);

      next();
    });
  }
}