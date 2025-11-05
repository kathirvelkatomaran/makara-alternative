// src/prisma/prisma-tenant-release.interceptor.ts
import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
  } from '@nestjs/common';
  import { Observable } from 'rxjs';
  import { tap } from 'rxjs/operators';
import { PrismaService } from 'src/prisma/prisma.service';
  
  @Injectable()
  export class PrismaTenantReleaseInterceptor implements NestInterceptor {
    private readonly logger = new Logger(PrismaTenantReleaseInterceptor.name);
  
    constructor(private readonly prisma: PrismaService) {}
  
    intercept(_: ExecutionContext, next: CallHandler): Observable<any> {
      return next.handle().pipe(
        tap({
          next: () => this.prisma.releaseCurrentTenantClient(),
          error: () => this.prisma.releaseCurrentTenantClient(),
          finalize: () => this.prisma.releaseCurrentTenantClient(), // ensures cleanup even on stream close
        }),
      );
    }
  }