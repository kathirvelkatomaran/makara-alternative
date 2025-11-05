import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) { }
  async create(data: any) {
    const db = this.prisma.forSchema(data.tenant)
    return db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'NEW User',
      },
    })
  }

  async findMany(tenant: string) {
    const db = this.prisma.forSchema(tenant)
    return db.user.findMany();
  }
}
