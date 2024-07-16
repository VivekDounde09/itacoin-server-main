import Redis from 'ioredis';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { DISTRIBUTE_GROWTH_QUEUE } from './investments.constants';
import { DistributeGrowthProcessor } from './processors';
import { PrismaModule } from '../prisma';
import { WalletsModule } from '../wallets';
import { ReferralsModule } from '../referrals';

@Module({
  imports: [
    PrismaModule,
    WalletsModule,
    ReferralsModule,
    BullModule.registerQueue({
      name: DISTRIBUTE_GROWTH_QUEUE,
      connection: new Redis(process.env.REDIS_URI as string, {
        maxRetriesPerRequest: null,
      }),
    }),
  ],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, DistributeGrowthProcessor],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
