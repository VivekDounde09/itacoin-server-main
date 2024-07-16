import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WalletTransaction,
  WalletTransactionContext,
  WalletTransactionType,
  WalletType,
} from '@prisma/client';
import { UserType } from '@Common';
import { WalletTransactionContextMeta } from './wallet-transactions.types';
import { PrismaService } from '../prisma';

@Injectable()
export class WalletTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      context: WalletTransactionContext;
      walletId: string;
      type: WalletTransactionType;
      amount: Prisma.Decimal;
      availableBalance: Prisma.Decimal;
      nonce: number;
      entityId?: string;
    },
    options?: { tx?: Prisma.TransactionClient },
  ) {
    const client = options?.tx ? options.tx : this.prisma;
    return await client.walletTransaction.create({
      data: {
        context: data.context,
        type: data.type,
        walletId: data.walletId,
        amount: data.amount,
        availableBalance: data.availableBalance,
        nonce: data.nonce,
        entityId: data.entityId,
      },
    });
  }

  async createMany(
    data: {
      context: WalletTransactionContext;
      walletId: string;
      type: WalletTransactionType;
      amount: Prisma.Decimal;
      availableBalance: Prisma.Decimal;
      nonce: number;
      entityId?: string;
    }[],
    options?: { tx?: Prisma.TransactionClient },
  ) {
    const client = options?.tx ? options.tx : this.prisma;
    return await client.walletTransaction.createMany({
      data: data.map((t) => ({
        context: t.context,
        type: t.type,
        walletId: t.walletId,
        amount: t.amount,
        availableBalance: t.availableBalance,
        nonce: t.nonce,
        entityId: t.entityId,
      })),
    });
  }

  async getAll(options?: {
    filters?: {
      userId?: string;
      walletType?: WalletType;
      fromDate?: Date;
      toDate?: Date;
    };
    orderBy?: keyof WalletTransaction;
    sortOrder?: Prisma.SortOrder;
    skip?: number;
    take?: number;
  }) {
    if (!options) options = {};
    if (!options.orderBy) {
      options.orderBy = 'nonce';
    }

    const where: Prisma.WalletTransactionWhereInput = {
      wallet: {
        userId: options.filters?.userId,
        type: options.filters?.walletType,
      },
      AND: [
        {
          createdAt: { gte: options.filters?.fromDate },
        },
        {
          createdAt: { lte: options.filters?.toDate },
        },
      ],
    };

    const totalTransactions = await this.prisma.walletTransaction.count({
      where,
    });
    const transactions = await this.prisma.walletTransaction.findMany({
      include: {
        wallet: {
          select: {
            type: true,
            user: true,
          },
        },
      },
      where,
      orderBy: {
        [options.orderBy]: options.sortOrder || Prisma.SortOrder.desc,
      },
      skip: options?.skip || 0,
      take: options?.take || 10,
    });

    return {
      count: totalTransactions,
      skip: options?.skip || 0,
      take: options?.take || 10,
      data: transactions,
    };
  }

  async narrationBuilder(
    tx: WalletTransaction,
    meta: WalletTransactionContextMeta,
  ): Promise<string> {
    if (meta.walletType === WalletType.Main) {
      switch (meta.context) {
        case WalletTransactionContext.Deposit:
          if (meta.userContext === UserType.Admin) {
            const { user } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            return `${username} deposited $${tx.amount}`;
          }
          return 'N/A';
        case WalletTransactionContext.Withdrawal:
          if (meta.userContext === UserType.Admin) {
            const { user } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            return `${username} withdrawal $${tx.amount}`;
          }
          return 'N/A';
        case WalletTransactionContext.Investment:
          if (meta.userContext === UserType.Admin) {
            const { user, investment } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            const plan = investment.basket.tier + 1;
            const portfolioId = investment.portfolioId;
            return `${username} invested $${tx.amount} in Plan ${plan} (Ref: ${portfolioId})`;
          }
          return 'N/A';
        case WalletTransactionContext.TradeWithdrawl:
          if (meta.userContext === UserType.Admin) {
            const { user, investment } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            const plan = investment.basket.tier + 1;
            const portfolioId = investment.portfolioId;
            return `${username} withdrawal $${tx.amount} from portfolio ${portfolioId} of Plan ${plan}`;
          }
          return 'N/A';
        case WalletTransactionContext.BonusWithdrawl:
          if (meta.userContext === UserType.Admin) {
            const { user } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            return `${username} withdrawal $${tx.amount} of earned bonus`;
          }
          return 'N/A';
      }
    } else if (meta.walletType === WalletType.Trade) {
      switch (meta.context) {
        case WalletTransactionContext.Investment:
          if (meta.userContext === UserType.Admin) {
            const { user, investment } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            const plan = investment.basket.tier + 1;
            const portfolioId = investment.portfolioId;
            return `${username} invested $${tx.amount} in Plan ${plan} (Ref: ${portfolioId})`;
          }
          return 'N/A';
        case WalletTransactionContext.InvestmentEarning:
          if (meta.userContext === UserType.Admin) {
            const { user, investmentEarning } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            const earning = investmentEarning.earning;
            const plan = investmentEarning.investment.basket.tier + 1;
            const portfolioId = investmentEarning.investment.portfolioId;
            return `${username} earned $${earning} from portfolio ${portfolioId} of Plan ${plan}`;
          }
          return 'N/A';
        case WalletTransactionContext.Withdrawal:
          if (meta.userContext === UserType.Admin) {
            const { user, investment } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            const plan = investment.basket.tier + 1;
            const portfolioId = investment.portfolioId;
            return `${username} withdrawal $${tx.amount} from portfolio ${portfolioId} of Plan ${plan}`;
          }
          return 'N/A';
      }
    } else if (meta.walletType === WalletType.Bonus) {
      switch (meta.context) {
        case WalletTransactionContext.Investment:
          if (meta.userContext === UserType.Admin) {
            const { user, referral, investment } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            const referralUsername = referral.firstname.concat(
              ' ',
              referral.lastname,
            );
            const plan = investment.basket.tier + 1;
            const portfolioId = investment.portfolioId;
            return `${username} earned $${tx.amount} from portfolio ${portfolioId} of Plan ${plan} of their referral ${referralUsername}`;
          }
          return 'N/A';
        case WalletTransactionContext.Unlock:
          if (meta.userContext === UserType.Admin) {
            const { user } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            return `${username} unlocked $${tx.amount}`;
          }
          return 'N/A';
        case WalletTransactionContext.Withdrawal:
          if (meta.userContext === UserType.Admin) {
            const { user } = meta;
            const username = user.firstname.concat(' ', user.lastname);
            return `${username} withdrawal $${tx.amount}`;
          }
          return 'N/A';
      }
    }

    return 'N/A';
  }
}
