import { Queue } from 'bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import _ from 'lodash';
import dayjs from 'dayjs';
import { ConfigType } from '@nestjs/config';
import {
  InvestmentBasket,
  Prisma,
  InvestmentStatus,
  Investment,
  InvestmentGrowth,
  InvestmentEarning,
  WalletType,
  WalletTransactionContext,
} from '@prisma/client';
import {
  distributeGrowthQueueConfigFactory,
  investmentConfigFactory,
} from '@Config';
import { UtilsService } from '@Common';
import { DISTRIBUTE_GROWTH_QUEUE } from './investments.constants';
import { Basket } from './dto';
import { PrismaService } from '../prisma';
import { WalletsService } from '../wallets';
import { ReferralsService } from '../referrals';

export type DistributeGrowthPayload = {
  growthId: string;
};

export type DistributeGrowthBonusPayload = {
  earningId: string;
};

const portfolioIdEnhancer = 14759000;

@Injectable()
export class InvestmentsService {
  constructor(
    @Inject(investmentConfigFactory.KEY)
    private readonly config: ConfigType<typeof investmentConfigFactory>,
    @Inject(distributeGrowthQueueConfigFactory.KEY)
    private readonly distributeGrowthQueueConfig: ConfigType<
      typeof distributeGrowthQueueConfigFactory
    >,
    // Distribute investment growth queue
    @InjectQueue(DISTRIBUTE_GROWTH_QUEUE)
    private readonly distributeGrowthQueue: Queue<
      DistributeGrowthPayload,
      void
    >,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly referralsService: ReferralsService,
    private readonly walletsService: WalletsService,
  ) {}

  private async addToDistributeGrowthQueue(data: DistributeGrowthPayload[]) {
    return await this.distributeGrowthQueue.addBulk(
      data.map((payload) => ({
        name: 'distributeGrowth',
        data: payload,
        opts: {
          attempts: this.distributeGrowthQueueConfig.attempts,
          delay: this.distributeGrowthQueueConfig.delay,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: {
            age: this.utilsService.msToSec(
              this.distributeGrowthQueueConfig.removeCompletedAfter,
            ),
          },
        },
      })),
    );
  }

  async getAllBaskets(): Promise<InvestmentBasket[]> {
    return await this.prisma.investmentBasket.findMany({
      orderBy: { tier: Prisma.SortOrder.asc },
    });
  }

  async getBasketById(basketId: string): Promise<InvestmentBasket> {
    return await this.prisma.investmentBasket.findUniqueOrThrow({
      where: { id: basketId },
    });
  }

  async getGrowthById(growthId: string): Promise<InvestmentGrowth | null> {
    return await this.prisma.investmentGrowth.findUnique({
      where: {
        id: growthId,
      },
    });
  }

  async getEarningById(earningId: string): Promise<InvestmentEarning> {
    return await this.prisma.investmentEarning.findUniqueOrThrow({
      where: { id: earningId },
    });
  }

  async getById(investmentId: string, userId: string): Promise<Investment> {
    const investment = await this.prisma.investment.findUniqueOrThrow({
      where: {
        id: investmentId,
        userId,
      },
    });
    investment.portfolioId += portfolioIdEnhancer;
    return investment;
  }

  async getByPortfolioId(
    portfolioId: number,
    userId: string,
  ): Promise<Investment> {
    portfolioId -= portfolioIdEnhancer;
    const investment = await this.prisma.investment.findUniqueOrThrow({
      where: {
        portfolioId,
        userId,
      },
    });
    investment.portfolioId += portfolioIdEnhancer;
    return investment;
  }

  async getCount(options?: {
    userId?: string;
    status?: InvestmentStatus;
  }): Promise<number> {
    return await this.prisma.investment.count({
      where: {
        userId: options?.userId,
        status: options?.status,
        NOT:
          options?.status !== InvestmentStatus.Switched
            ? { status: InvestmentStatus.Switched }
            : undefined,
      },
    });
  }

  async getTotalEarning(options?: {
    userId?: string;
  }): Promise<Prisma.Decimal> {
    const response = await this.prisma.investmentEarning.aggregate({
      _sum: {
        earning: true,
      },
      where: {
        investment: {
          userId: options?.userId,
          NOT: { status: InvestmentStatus.Switched },
        },
      },
    });

    return response._sum.earning || new Prisma.Decimal(0);
  }

  async hasOf(userId: string): Promise<boolean> {
    return (
      (await this.prisma.investment.count({
        where: {
          userId,
        },
      })) !== 0
    );
  }

  async getAll(options?: {
    filters?: {
      userId?: string;
      investmentId?: string;
      portfolioId?: number;
      fromDate?: Date;
      toDate?: Date;
      tier?: number;
      status?: InvestmentStatus;
    };
    skip?: number;
    take?: number;
  }) {
    if (options?.filters?.portfolioId) {
      options.filters.portfolioId -= portfolioIdEnhancer;
    }
    const where: Prisma.InvestmentWhereInput = {
      id: options?.filters?.investmentId,
      userId: options?.filters?.userId,
      portfolioId: options?.filters?.portfolioId,
      status: options?.filters?.status,
      NOT:
        options?.filters?.status !== InvestmentStatus.Switched
          ? { status: InvestmentStatus.Switched }
          : undefined,
      basket: {
        tier: options?.filters?.tier,
      },
      AND: [
        {
          createdAt: { gte: options?.filters?.fromDate },
        },
        {
          createdAt: { lte: options?.filters?.toDate },
        },
      ],
    };

    const investments = await this.prisma.investment.findMany({
      include: {
        basket: true,
        user: true,
      },
      where,
      orderBy: {
        createdAt: Prisma.SortOrder.desc,
      },
      skip: options?.skip,
      take: options?.take,
    });
    return investments.map((investment) => ({
      ...investment,
      portfolioId: investment.portfolioId + portfolioIdEnhancer,
    }));
  }

  async getTotalAmount(userId: string): Promise<Prisma.Decimal> {
    const response = await this.prisma.investment.aggregate({
      _sum: {
        amount: true,
      },
      where: { userId, NOT: { status: InvestmentStatus.Switched } },
    });
    return response._sum.amount || new Prisma.Decimal(0);
  }

  async getPortfolioByUserId(
    userId: string,
  ): Promise<
    (Pick<InvestmentBasket, 'id' | 'tier'> & { investedAmount: string })[]
  > {
    const query = Prisma.sql`SELECT ib.id, ib.tier, COALESCE(SUM(i.amount), 0)::DECIMAL(12,2) as invested_amount FROM investment_basket ib LEFT JOIN investment i ON ib.id = i.basket_id AND i.user_id = ${userId}::UUID AND i.status = 'active' GROUP BY ib.id ORDER BY ib.tier;`;

    const rawQueryResponse = await this.prisma.$queryRaw<
      {
        id: string;
        tier: number;
        invested_amount: string;
      }[]
    >(query);

    return rawQueryResponse.map((data) => ({
      id: data.id,
      tier: data.tier,
      investedAmount: data.invested_amount,
    }));
  }

  async getStats(options?: { fromDate?: Date; toDate?: Date }) {
    const baskets = await this.prisma.investmentBasket.findMany();
    const query = Prisma.sql`SELECT ib.tier, COALESCE(SUM(i.amount), 0)::DECIMAL(12,2) AS investment_amount 
      FROM investment_basket ib
      LEFT JOIN investment i
      ON ib.id = i.basket_id
      WHERE
      i.status != 'switched'
      ${
        options?.fromDate
          ? Prisma.sql`AND i.created_at >= ${options.fromDate}`
          : Prisma.empty
      }
      ${
        options?.toDate
          ? Prisma.sql`AND i.created_at <= ${options.toDate}`
          : Prisma.empty
      } 
      GROUP BY ib.tier
    ;`;

    const data = await this.prisma.$queryRaw<
      {
        tier: string;
        investment_amount: string;
      }[]
    >(query);

    const response = _.keyBy(
      baskets.map((basket) => ({
        tier: basket.tier,
        investmentAmount: '0',
      })),
      'tier',
    );
    data.forEach((basket) => {
      response[basket.tier].investmentAmount = basket.investment_amount;
    });

    return response;
  }

  async invest(
    userId: string,
    basketId: string,
    amount: Prisma.Decimal,
    tenure: number,
    startDate: Date,
    options: {
      tx: Prisma.TransactionClient;
      switchBasket?: boolean;
    },
  ) {
    const client = options.tx;

    if (amount.lessThanOrEqualTo(0)) {
      throw new Error('Amount should be more than zero');
    }
    if (![3].includes(tenure)) {
      throw new Error('Invalid investment tenure');
    }

    const investment = await client.investment.create({
      data: {
        initialAmount: amount,
        amount,
        userId,
        basketId,
        tenure,
        startedAt: startDate,
      },
    });

    // Transfer amount to trade wallet
    await this.walletsService.transferAmountMainToTrade(userId, amount, {
      tx: options.tx,
      mainContext: WalletTransactionContext.Investment,
      tradeContext: WalletTransactionContext.Investment,
      entityId: investment.id,
    });

    if (!options.switchBasket) {
      const referrer = await this.referralsService.getReferrerOf(userId);
      if (referrer && (await this.hasOf(referrer.id))) {
        await this.referralsService.createInvestmentBonus(
          referrer.id,
          userId,
          investment.id,
          investment.amount,
          { tx: options.tx },
        );
      }
    }

    return investment;
  }

  async getTotalTradeAmount(options?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<Prisma.Decimal> {
    const where: Prisma.InvestmentWhereInput = {};
    if (options?.fromDate && options.toDate) {
      where.createdAt = {
        gte: options.fromDate,
        lte: options.toDate,
      };
    }

    const response = await this.prisma.investment.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        ...where,
        NOT: { status: InvestmentStatus.Switched },
      },
    });

    return response._sum.amount || new Prisma.Decimal(0);
  }

  private whereInputToGetCountOf(
    month: number,
    year: number,
    basketId?: string,
  ): Prisma.InvestmentWhereInput {
    const [startDate, endDate] = [
      dayjs()
        .date(this.config.growthStartDate)
        .month(month - 1)
        .year(year)
        .startOf('date'),
      dayjs()
        .month(month - 1)
        .year(year)
        .endOf('month'),
    ];

    return {
      basketId,
      startedAt: { lte: endDate.toDate() },
      OR: [
        { status: InvestmentStatus.Active },
        {
          closedAt: { gte: startDate.toDate(), lte: endDate.toDate() },
        },
      ],
    };
  }

  async getCountOf(
    month: number,
    year: number,
    options?: {
      tx?: Prisma.TransactionClient;
      filters?: {
        basketId?: string;
      };
    },
  ): Promise<number> {
    const client = options?.tx ? options.tx : this.prisma;
    return await client.investment.count({
      where: this.whereInputToGetCountOf(
        month,
        year,
        options?.filters?.basketId,
      ),
    });
  }

  async getAllOf(
    month: number,
    year: number,
    options?: {
      filters?: {
        basketId?: string;
      };
      skip?: number;
      take?: number;
    },
  ) {
    const [basketId, skip, take] = [
      options?.filters?.basketId,
      options?.skip || 0,
      options?.take || 10,
    ];

    const investments = await this.prisma.investment.findMany({
      where: this.whereInputToGetCountOf(month, year, basketId),
      skip,
      take,
      orderBy: { id: Prisma.SortOrder.asc },
    });
    const count = await this.getCountOf(month, year, {
      filters: { basketId },
    });

    return {
      count,
      skip,
      take,
      data: investments,
    };
  }

  private async isGrowthAlreadyExist(
    basketId: string,
    month: number,
    year: number,
  ) {
    return (
      (await this.prisma.investmentGrowth.count({
        where: {
          month,
          year,
          basketId,
        },
      })) !== 0
    );
  }

  async createGrowth(data: { month: number; year: number; baskets: Basket[] }) {
    const baskets = await this.getAllBaskets();

    // Validate baskets
    if (
      baskets.length !== data.baskets.length ||
      _.difference(
        baskets.map((b) => b.id),
        data.baskets.map((b) => b.id),
      ).length
    ) {
      throw new Error('Invalid baskets');
    }

    return await this.prisma.$transaction(async (tx) => {
      const { month, year, baskets } = data;
      const [currentMonth, currentYear] = [dayjs().month() + 1, dayjs().year()];
      if (year > currentYear || month >= currentMonth) {
        throw new Error(
          'Setting growth rate for current or upcoming month is not allowed',
        );
      }

      const investmentGrowths = await Promise.all(
        baskets.map(async (basket) => {
          if (await this.isGrowthAlreadyExist(basket.id, month, year)) {
            throw new Error(
              'Growth rate for provided month and year is already exist',
            );
          }

          const affected = await this.getCountOf(month, year, {
            filters: { basketId: basket.id },
            tx,
          });
          return await tx.investmentGrowth.create({
            data: {
              basketId: basket.id,
              growth: basket.growth,
              month,
              year,
              affected,
            },
          });
        }),
      );

      // Add to queue
      await this.addToDistributeGrowthQueue(
        investmentGrowths.map((growth) => ({
          growthId: growth.id,
        })),
      );

      return investmentGrowths;
    });
  }

  async getGrowth(
    basketId: string,
    month: number,
    year: number,
  ): Promise<InvestmentGrowth & { basket: InvestmentBasket }> {
    return await this.prisma.investmentGrowth.findUniqueOrThrow({
      include: {
        basket: true,
      },
      where: {
        basketId_month_year: {
          basketId,
          month,
          year,
        },
      },
    });
  }

  async getAllGrowths(options?: {
    filter?: { year?: number; month?: number };
    skip?: number;
    take?: number;
  }): Promise<(InvestmentGrowth & { basket: InvestmentBasket })[]> {
    const where: Prisma.InvestmentGrowthWhereInput = {};
    if (options?.filter) {
      where.year = options.filter.year;
      where.month = options.filter.month;
    }

    return await this.prisma.investmentGrowth.findMany({
      include: {
        basket: true,
      },
      where,
      skip: options?.skip || 0,
      take: options?.take || 10,
      orderBy: [
        {
          year: Prisma.SortOrder.desc,
        },
        {
          month: Prisma.SortOrder.asc,
        },
      ],
    });
  }

  async switchBasket(
    userId: string,
    investmentId: string,
    newBasketId: string,
  ): Promise<Investment> {
    const currentInvestment = await this.getById(investmentId, userId);
    if (
      currentInvestment.status !== InvestmentStatus.Active ||
      dayjs(currentInvestment.startedAt).isAfter(dayjs())
    ) {
      throw new Error('Switch basket is permitted for active investments');
    }
    if (currentInvestment.basketId === newBasketId) {
      throw new Error('Switch to the same basket not permitted');
    }
    if (
      dayjs().date() < this.config.minimumDateToSwitch ||
      dayjs().date() > this.config.maximumDateToSwitch
    ) {
      throw new Error('Switch basket not permitted in this time period');
    }

    const startDate = dayjs()
      .add(this.config.basketSwitchDuration, 'ms')
      .toDate();

    return await this.prisma.$transaction(async (tx) => {
      const newInvestment = await this.invest(
        userId,
        newBasketId,
        currentInvestment.amount,
        currentInvestment.tenure,
        startDate,
        { tx, switchBasket: true },
      );

      await tx.investment.update({
        data: {
          closedAt: new Date(),
          status: InvestmentStatus.Switched,
          switchedTo: newInvestment.id,
        },
        where: {
          id: currentInvestment.id,
        },
      });

      return newInvestment;
    });
  }

  async redeem(userId: string, investmentId: string): Promise<Investment> {
    const investment = await this.getById(investmentId, userId);
    if (investment.status !== InvestmentStatus.Active) {
      throw new Error('Redeem is permitted for active investments only');
    }

    if (dayjs().diff(investment.startedAt, 'days') <= investment.tenure * 30) {
      throw new Error(
        'Redeem is permitted after 90 days from the date of investment only',
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      const closedInvestment = await tx.investment.update({
        data: { closedAt: new Date(), status: InvestmentStatus.Closed },
        where: {
          id: investment.id,
        },
      });

      if (closedInvestment.amount.greaterThan(0)) {
        await this.walletsService.transferAmountTradeToMain(
          userId,
          closedInvestment.amount,
          {
            tx,
            mainContext: WalletTransactionContext.TradeWithdrawl,
            tradeContext: WalletTransactionContext.Withdrawal,
            entityId: closedInvestment.id,
          },
        );
      }

      return closedInvestment;
    });
  }

  async createEarning(
    data: {
      userId: string;
      growthId: string;
      investmentId: string;
      amount: Prisma.Decimal;
      earning: Prisma.Decimal;
    },
    options: { tx: Prisma.TransactionClient },
  ): Promise<InvestmentEarning> {
    const client = options.tx;

    const newInvestmentAmount = data.amount.add(data.earning);
    if (data.amount.lessThan(0) || newInvestmentAmount.lessThan(0)) {
      throw new Error('Amount underflow');
    }

    const [investmentEarning] = await Promise.all([
      // Create earning
      client.investmentEarning.create({
        data: {
          growthId: data.growthId,
          investmentId: data.investmentId,
          amount: data.amount,
          earning: data.earning,
        },
      }),
      // Update investment amount
      client.investment.update({
        data: {
          amount: newInvestmentAmount,
        },
        where: {
          id: data.investmentId,
          userId: data.userId,
        },
      }),
    ]);

    // Update wallets
    if (data.earning.greaterThan(0)) {
      await this.walletsService.addBalance(
        data.userId,
        data.earning,
        WalletType.Trade,
        {
          tx: options.tx,
          context: WalletTransactionContext.InvestmentEarning,
          entityId: investmentEarning.id,
        },
      );
    }

    if (data.earning.lessThan(0)) {
      await this.walletsService.subtractBalance(
        data.userId,
        data.earning,
        WalletType.Trade,
        {
          tx: options.tx,
          context: WalletTransactionContext.InvestmentEarning,
          entityId: investmentEarning.id,
        },
      );
    }

    return investmentEarning;
  }
}
