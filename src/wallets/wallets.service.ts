import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Wallet,
  WalletTransactionContext,
  WalletTransactionType,
  WalletType,
  WithdrawStatus,
} from '@prisma/client';
import { UtilsService } from '@Common';
import { PrismaService } from '../prisma';
import { WalletTransactionsService } from '../wallet-transactions';

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly walletTransactionsService: WalletTransactionsService,
  ) {}

  // TODO: This should be in withdraws moudle,
  // but due to circular issue duplicated from withdraw service
  private async getPendingWithdrawAmountOf(
    userId: string,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Prisma.Decimal> {
    const client = options?.tx ? options.tx : this.prisma;
    const response = await client.withdraw.aggregate({
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

  async getById(
    walletId: string,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Wallet> {
    const client = options?.tx ? options.tx : this.prisma;
    return await client.wallet.findUniqueOrThrow({
      where: { id: walletId },
    });
  }

  async getAllByUserId(
    userId: string,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Wallet[]> {
    const client = options?.tx ? options.tx : this.prisma;
    return await client.wallet.findMany({ where: { userId } });
  }

  async getByUserId(
    userId: string,
    type: WalletType,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Wallet> {
    const client = options?.tx ? options.tx : this.prisma;
    return await client.wallet.findUniqueOrThrow({
      where: { userId_type: { userId, type } },
    });
  }

  async getUseableMainBalanceOf(
    userId: string,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Prisma.Decimal> {
    const mainWallet = await this.getByUserId(userId, WalletType.Main, {
      tx: options?.tx,
    });
    const pendingWithdrawAmount = await this.getPendingWithdrawAmountOf(
      userId,
      {
        tx: options?.tx,
      },
    );
    return mainWallet.amount.sub(pendingWithdrawAmount);
  }

  async create(userId: string, options?: { tx?: Prisma.TransactionClient }) {
    const client = options?.tx ? options.tx : this.prisma;
    const wallets: Prisma.WalletCreateManyInput[] = [
      {
        type: WalletType.Main,
        userId,
      },
      {
        type: WalletType.Bonus,
        userId,
      },
      {
        type: WalletType.Trade,
        userId,
      },
    ];
    return await client.wallet.createMany({
      data: wallets,
    });
  }

  // TODO: Need to implement application level lock mechanism
  async addBalance(
    userId: string,
    amount: Prisma.Decimal,
    type: WalletType,
    options: {
      tx: Prisma.TransactionClient;
      context: WalletTransactionContext;
      entityId?: string;
    },
  ) {
    const client = options.tx;

    // Remove sign
    amount = amount.abs();
    if (amount.eq(0)) {
      throw new Error('Amount should not be non zero');
    }

    return await this.utilsService.occrunnable(async () => {
      const wallet = await this.getByUserId(userId, type, { tx: options.tx });
      const updatedWallet = await client.wallet.update({
        data: {
          amount: {
            increment: amount,
          },
          version: { increment: 1 },
        },
        where: {
          id: wallet.id,
          version: wallet.version,
        },
      });

      await this.walletTransactionsService.create({
        context: options.context,
        walletId: wallet.id,
        type: WalletTransactionType.Credit,
        amount,
        availableBalance: updatedWallet.amount,
        nonce: updatedWallet.version,
        entityId: options.entityId,
      });

      return updatedWallet;
    });
  }

  // TODO: Need to implement application level lock mechanism
  async subtractBalance(
    userId: string,
    amount: Prisma.Decimal,
    type: WalletType,
    options: {
      tx: Prisma.TransactionClient;
      context: WalletTransactionContext;
      entityId?: string;
    },
  ) {
    const client = options.tx;

    // Remove sign
    amount = amount.abs();
    if (amount.eq(0)) {
      throw new Error('Amount should not be non zero');
    }

    return await this.utilsService.occrunnable(async () => {
      const wallet = await this.getByUserId(userId, type, { tx: options.tx });
      const newAmount = wallet.amount.sub(amount);
      if (newAmount.lessThan(0)) {
        throw new Error('Amount underflow');
      }

      const updatedWallet = await client.wallet.update({
        data: {
          amount: newAmount,
          version: { increment: 1 },
        },
        where: {
          id: wallet.id,
          version: wallet.version,
        },
      });

      await this.walletTransactionsService.create({
        context: options.context,
        walletId: wallet.id,
        type: WalletTransactionType.Debit,
        amount,
        availableBalance: updatedWallet.amount,
        nonce: updatedWallet.version,
        entityId: options.entityId,
      });

      return updatedWallet;
    });
  }

  async transferAmountMainToTrade(
    userId: string,
    amount: Prisma.Decimal,
    options: {
      tx: Prisma.TransactionClient;
      mainContext: WalletTransactionContext;
      tradeContext: WalletTransactionContext;
      entityId?: string;
    },
  ) {
    // Remove sign
    amount = amount.abs();

    return await this.utilsService.occrunnable(async () => {
      const useableMainBalance = await this.getUseableMainBalanceOf(userId, {
        tx: options.tx,
      });
      if (useableMainBalance.lessThan(amount)) {
        throw new Error('Insufficient balance in main wallet');
      }

      return await Promise.all([
        this.addBalance(userId, amount, WalletType.Trade, {
          tx: options.tx,
          context: options.tradeContext,
          entityId: options.entityId,
        }),
        this.subtractBalance(userId, amount, WalletType.Main, {
          tx: options.tx,
          context: options.mainContext,
          entityId: options.entityId,
        }),
      ]);
    });
  }

  async transferAmountTradeToMain(
    userId: string,
    amount: Prisma.Decimal,
    options: {
      tx: Prisma.TransactionClient;
      mainContext: WalletTransactionContext;
      tradeContext: WalletTransactionContext;
      entityId?: string;
    },
  ) {
    // Remove sign
    amount = amount.abs();

    return await this.utilsService.occrunnable(async () => {
      return await Promise.all([
        this.addBalance(userId, amount, WalletType.Main, {
          tx: options.tx,
          context: options.mainContext,
          entityId: options.entityId,
        }),
        this.subtractBalance(userId, amount, WalletType.Trade, {
          tx: options.tx,
          context: options.tradeContext,
          entityId: options.entityId,
        }),
      ]);
    });
  }

  async transferAmountBonusToMain(
    userId: string,
    amount: Prisma.Decimal,
    options: {
      tx: Prisma.TransactionClient;
      mainContext: WalletTransactionContext;
      bonusContext: WalletTransactionContext;
      entityId?: string;
    },
  ) {
    // Remove sign
    amount = amount.abs();

    return await this.utilsService.occrunnable(async () => {
      return await Promise.all([
        this.addBalance(userId, amount, WalletType.Main, {
          tx: options.tx,
          context: options.mainContext,
          entityId: options.entityId,
        }),
        this.subtractBalance(userId, amount, WalletType.Bonus, {
          tx: options.tx,
          context: options.bonusContext,
          entityId: options.entityId,
        }),
      ]);
    });
  }

  async getTotalMainAmount(): Promise<Prisma.Decimal> {
    const response = await this.prisma.wallet.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        type: WalletType.Main,
      },
    });

    return response._sum.amount || new Prisma.Decimal(0);
  }
}
