import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../prisma';
import { WalletsModule } from '../wallets';
import { InvestmentsModule } from '../investments';
import { ReferralsModule } from '../referrals';
import { UsersModule } from '../users';

@Module({
  imports: [
    PrismaModule,
    WalletsModule,
    InvestmentsModule,
    ReferralsModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
