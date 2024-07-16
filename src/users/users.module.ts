import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma';
import { WalletsModule } from '../wallets';
import { InvestmentsModule } from '../investments';
import { ReferralsModule } from '../referrals';
import { PaymentsModule } from '../payments';
import { RedisModule } from '../redis';
import { SettingsModule } from '../settings';
import { WalletTransactionsModule } from '../wallet-transactions';

@Module({
  imports: [
    HttpModule,
    PrismaModule,
    RedisModule,
    SettingsModule,
    WalletsModule,
    InvestmentsModule,
    PaymentsModule,
    ReferralsModule,
    WalletTransactionsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
