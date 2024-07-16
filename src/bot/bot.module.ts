import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { UsersModule } from '../users';
import { SettingsModule } from '../settings';
import { RedisModule } from '../redis';
import { PaymentsModule } from '../payments';
import { WalletsModule } from '../wallets';
import { InvestmentsModule } from '../investments';
import { WithdrawsModule } from '../withdraws';
import { ReferralsModule } from '../referrals';
import { PrismaModule } from '../prisma';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    UsersModule,
    SettingsModule,
    PaymentsModule,
    WalletsModule,
    InvestmentsModule,
    WithdrawsModule,
    ReferralsModule,
  ],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
