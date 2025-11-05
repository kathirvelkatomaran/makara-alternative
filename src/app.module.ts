import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { TenantMiddleware } from './utils/tenant.middleware';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaTenantReleaseInterceptor } from './utils/tenant.interceptor';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [PrismaModule, UsersModule, TenantsModule],
  controllers: [AppController],
  providers: [
    AppService
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly prisma: PrismaService) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        // Wrap to inject prisma into req
        (req: any, res: any, next: any) => {
          req.prisma = this.prisma;
          TenantMiddleware(req, res, next);
        },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
