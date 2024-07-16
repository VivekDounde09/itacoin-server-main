import dayjs from 'dayjs';
import { Queue } from 'bullmq';
import { ethers } from 'ethers';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { JsonValue } from '@prisma/client/runtime/library';
import {
  Prisma,
  WithdrawStatus,
  Withdraw,
  WalletType,
  WalletTransactionContext,
} from '@prisma/client';
import { UtilsService } from '@Common';
import { payoutQueueConfigFactory } from '@Config';
import { PAYOUT_QUEUE } from './withdraws.constants';
import { PrismaService } from '../prisma';
import { WalletsService } from '../wallets';
import { SettingsService } from '../settings';

export type PayoutPayload = {
  withdrawId: string;
};

@Injectable()
export class WithdrawsService {
  constructor(
    @Inject(payoutQueueConfigFactory.KEY)
    private readonly payoutQueueConfig: ConfigType<
      typeof payoutQueueConfigFactory
    >,
    @InjectQueue(PAYOUT_QUEUE)
    private readonly payoutQueue: Queue<PayoutPayload, void>,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly walletsService: WalletsService,
    private readonly settingService: SettingsService,
  ) {}

  private async addToPayoutQueue(data: PayoutPayload, delay: number) {
    return await this.payoutQueue.add('payout', data, {
      attempts: this.payoutQueueConfig.attempts,
      delay,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        age: this.utilsService.msToSec(
          this.payoutQueueConfig.removeCompletedAfter,
        ),
      },
    });
  }

  private async getExpectedResolveTime(): Promise<Date> {
    const settings = await this.settingService.getSystemSettings('withdraw');

    const resolveTimeSetting = settings.find(
      (setting) => setting.mappedTo === 'withdraw.resolveTime',
    );
    const batchCeaseBeforeSetting = settings.find(
      (setting) => setting.mappedTo === 'withdraw.batchCeaseBefore',
    );
    if (!resolveTimeSetting || !batchCeaseBeforeSetting) {
      throw new Error('Withdraw settings not found');
    }

    const resolveTime = String(
      resolveTimeSetting.selection || resolveTimeSetting.default,
    );
    const batchCeaseBefore = Number(
      batchCeaseBeforeSetting.selection || batchCeaseBeforeSetting.default,
    );

    if (
      !/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(resolveTime) ||
      typeof batchCeaseBefore !== 'number' ||
      batchCeaseBefore < 0
    ) {
      throw new Error('Invalid withdraw settings found');
    }

    // Extract hour and minute values from the time string
    const [hour, minute] = resolveTime.split(':').map(Number);

    let day = 0;
    do {
      const resolveTime = dayjs()
        .set('hour', hour)
        .set('minute', minute)
        .startOf('minute')
        .add(day, 'day');
      const batchCeaseTime = resolveTime.subtract(batchCeaseBefore, 'hour');

      if (dayjs().isBefore(batchCeaseTime)) {
        return resolveTime.toDate();
      } else {
        day++;
      }
    } while (true);
  }

  async getPendingById(withdrawId: string): Promise<Withdraw | null> {
    return await this.prisma.withdraw.findUnique({
      where: {
        id: withdrawId,
        status: WithdrawStatus.Pending,
      },
    });
  }

  async getPendingAmountOf(userId: string): Promise<Prisma.Decimal> {
    const response = await this.prisma.withdraw.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        userId,
        status: WithdrawStatus.Pending,
      },
    });
    return response._sum.amount || new Prisma.Decimal(0);
  }

  async getProcessedAmountOf(userId: string): Promise<Prisma.Decimal> {
    const response = await this.prisma.withdraw.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        userId,
        status: WithdrawStatus.Processed,
      },
    });
    return response._sum.amount || new Prisma.Decimal(0);
  }

  async create(
    userId: string,
    address: string,
    amount: number | Prisma.Decimal,
  ): Promise<Withdraw> {
    if (typeof amount === 'number') {
      amount = new Prisma.Decimal(amount).toDP(2);
    }
    if (
      this.utilsService.isZeroAddress(address) ||
      !ethers.isAddress(address)
    ) {
      throw new Error('Invalid wallet address');
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new Error('Amount should be more than zero');
    }

    const currentMainBalance =
      await this.walletsService.getUseableMainBalanceOf(userId);
    if (currentMainBalance.lessThan(amount)) {
      throw new Error(
        'Insufficient balance, Please check you might already have a pending withdraw requests',
      );
    }

    return await this.prisma.$transaction(async () => {
      const expectedTime = await this.getExpectedResolveTime();
      const withdraw = await this.prisma.withdraw.create({
        data: {
          address: address.toLowerCase(),
          amount,
          expectedTime,
          userId,
        },
      });

      const delay = dayjs(expectedTime).diff(dayjs(), 'ms');
      await this.addToPayoutQueue({ withdrawId: withdraw.id }, delay);
      return withdraw;
    });
  }

  async getAll(options?: {
    filters?: {
      fromDate?: Date;
      toDate?: Date;
      status?: WithdrawStatus;
      address?: string;
    };
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.WithdrawWhereInput = {};
    if (options?.filters) {
      const { fromDate, toDate, status, address } = options.filters;

      where.address = address?.toLowerCase();

      if (status === WithdrawStatus.Processed) {
        where.status = {
          in: [WithdrawStatus.Processed, WithdrawStatus.Failed],
        };
      } else {
        where.status = status;
      }

      if (fromDate && toDate) {
        where.createdAt = {
          gte: fromDate,
          lte: toDate,
        };
      }
    }

    const count = await this.prisma.withdraw.count({
      where,
    });
    const totalAmount = await this.prisma.withdraw.aggregate({
      _sum: { amount: true },
      where,
    });
    const withdraws = await this.prisma.withdraw.findMany({
      include: {
        user: {
          include: {
            wallets: true,
          },
        },
      },
      where,
      skip: options?.skip || 0,
      take: options?.take || 10,
      orderBy: {
        createdAt: Prisma.SortOrder.desc,
      },
    });

    return {
      count,
      skip: options?.skip || 0,
      take: options?.take || 10,
      data: { totalAmount: totalAmount._sum.amount || 0, withdraws },
    };
  }

  async updateOnPayout(data: {
    withdrawId: string;
    status: WithdrawStatus;
    txhash?: string;
    reason?: JsonValue;
  }) {
    return await this.prisma.$transaction(async (tx) => {
      const withdraw = await tx.withdraw.update({
        data: {
          status: data.status,
          txhash: data.txhash,
          reason: data.reason !== null && data.reason,
          processedAt: new Date(),
        },
        where: {
          id: data.withdrawId,
          status: WithdrawStatus.Pending,
        },
      });

      if (withdraw.status === WithdrawStatus.Processed) {
        await this.walletsService.subtractBalance(
          withdraw.userId,
          withdraw.amount,
          WalletType.Main,
          {
            tx,
            context: WalletTransactionContext.Withdrawal,
            entityId: withdraw.id,
          },
        );
      }
    });
  }
}
