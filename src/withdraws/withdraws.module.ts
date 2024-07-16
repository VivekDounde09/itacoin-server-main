import Redis from 'ioredis';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PayoutProcessor } from './processors';
import { WithdrawsService } from './withdraws.service';
import { PAYOUT_QUEUE } from './withdraws.constants';
import { WithdrawsController } from './withdraws.controller';
import { LedgerModule } from '../ledger';
import { PrismaModule } from '../prisma';
import { WalletsModule } from '../wallets';
import { SettingsModule } from '../settings';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    WalletsModule,
    LedgerModule,
    BullModule.registerQueue({
      name: PAYOUT_QUEUE,
      connection: new Redis(process.env.REDIS_URI as string, {
        maxRetriesPerRequest: null,
      }),
    }),
  ],
  controllers: [WithdrawsController],
  providers: [WithdrawsService, PayoutProcessor],
  exports: [WithdrawsService],
})
export class WithdrawsModule {}
