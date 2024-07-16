import { Job } from 'bullmq';
import dayjs from 'dayjs';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { BaseProcessor } from '@Common';
import {
  distributeGrowthQueueConfigFactory,
  investmentConfigFactory,
} from '@Config';
import {
  DistributeGrowthPayload,
  InvestmentsService,
} from '../investments.service';
import { DISTRIBUTE_GROWTH_QUEUE } from '../investments.constants';
import { PrismaService } from '../../prisma';

@Processor(DISTRIBUTE_GROWTH_QUEUE)
export class DistributeGrowthProcessor extends BaseProcessor {
  constructor(
    @Inject(distributeGrowthQueueConfigFactory.KEY)
    readonly config: ConfigType<typeof distributeGrowthQueueConfigFactory>,
    @Inject(investmentConfigFactory.KEY)
    private readonly investmentConfig: ConfigType<
      typeof investmentConfigFactory
    >,
    private readonly prisma: PrismaService,
    private readonly investmentsService: InvestmentsService,
  ) {
    super(DistributeGrowthProcessor.name, config.concurrency);
  }

  // TODO: Improvement to support parallel processing
  async process(job: Job<DistributeGrowthPayload, void>) {
    const { growthId } = job.data;

    const investmentGrowth = await this.investmentsService.getGrowthById(
      growthId,
    );
    if (
      !investmentGrowth ||
      investmentGrowth.affected === 0 ||
      investmentGrowth.affected === investmentGrowth.processed
    ) {
      return;
    }

    const { month, year, basketId } = investmentGrowth;
    const [growthStartDate, growthEndDate] = [
      dayjs()
        .date(this.investmentConfig.growthStartDate)
        .month(month - 1)
        .year(year)
        .startOf('date'),
      dayjs()
        .month(month - 1)
        .year(year)
        .endOf('month'),
    ];

    const currentAffectedInvestmentCount =
      await this.investmentsService.getCountOf(month, year, {
        filters: { basketId },
      });

    if (currentAffectedInvestmentCount !== investmentGrowth.affected) {
      throw new Error(
        'Growth affected investments count did not matched with current affected count',
      );
    }

    const { growth } = investmentGrowth;
    const growthPerDay = growth
      .div(growthEndDate.diff(growthStartDate, 'days'))
      .toDP(2);

    let offset = investmentGrowth.processed;
    let investments = [];
    do {
      const response = await this.investmentsService.getAllOf(month, year, {
        filters: { basketId },
        skip: offset,
        take: this.config.batchSize,
      });
      offset += this.config.batchSize;
      investments = response.data;

      const earnings: {
        userId: string;
        investmentId: string;
        amount: Prisma.Decimal;
        earning: Prisma.Decimal;
      }[] = [];

      for (const investment of investments) {
        const startDate = dayjs(investment.startedAt).isBefore(growthStartDate)
          ? growthStartDate
          : dayjs(investment.startedAt).add(1, 'day').startOf('date');
        const endDate = investment.closedAt
          ? dayjs(investment.closedAt).subtract(1, 'day').endOf('date')
          : growthEndDate;

        let earning = investment.amount
          .mul(growthPerDay.mul(endDate.diff(startDate, 'days')))
          .div(100)
          .toDP(2);
        if (earning.isNeg() && investment.amount.sub(earning.abs()).isNeg()) {
          earning = investment.amount.mul(-1);
        }

        earnings.push({
          userId: investment.userId,
          investmentId: investment.id,
          amount: investment.amount,
          earning,
        });
      }

      // TODO: Optimization needed to increase batch size of processor
      await this.prisma.$transaction(async (tx) => {
        await Promise.all(
          earnings.map(async (earning) => {
            return await this.investmentsService.createEarning(
              {
                growthId: investmentGrowth.id,
                userId: earning.userId,
                investmentId: earning.investmentId,
                amount: earning.amount,
                earning: earning.earning,
              },
              { tx },
            );
          }),
        );

        await tx.investmentGrowth.update({
          data: {
            processed: { increment: investments.length },
          },
          where: {
            id: investmentGrowth.id,
          },
        });
      });
    } while (investments.length === this.config.batchSize);
  }
}
