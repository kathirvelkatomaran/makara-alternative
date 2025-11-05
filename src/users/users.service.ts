import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) { }
  async create(data: any) {
    // const client = await this.prisma.getCurrentClient();
    return await this.prisma.client.user.create({
      data: {
        name:"Name Test User",
        email:`${Date.now()}test@example.com`,
      }
    });
  }

  async findMany(tenant: string) {
    // const client = await this.prisma.getCurrentClient();
    return await this.prisma.client.user.findMany();
    // const db = this.prisma.forSchema(tenant)
    // return db.$replica().user.findMany();
  }
}
