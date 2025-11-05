// src/tenants/tenants.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  async create(@Body('name') name: string) {
    await this.tenantsService.createTenant(name);
    return { message: `Tenant '${name}' created and synced.` };
  }

  @Post('sync')
  async sync(@Body('name') name: string) {
    await this.tenantsService.syncTenant(name);
    return { message: `Tenant '${name}' synced.` };
  }
}