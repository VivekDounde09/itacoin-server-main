import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import _ from 'lodash';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';
import {
  Investment,
  Prisma,
  User,
  UserMeta,
  UserStatus,
  Wallet,
  WalletTransaction,
  WalletTransactionContext,
  WalletType,
} from '@prisma/client';
import { Language, UserType, UtilsService } from '@Common';
import { appConfigFactory, userConfigFactory } from '@Config';
import { PrismaService } from '../prisma';
import { WalletsService } from '../wallets';
import { ReferralsService, ReferralStats, Referrer } from '../referrals';
import { InvestmentsService } from '../investments';
import { PaymentsService } from '../payments';
import { RedisService } from '../redis';
import { SettingsService } from '../settings';
import { WalletTransactionsService } from '../wallet-transactions';
import { PaymentSuccessEvent } from 'src/bot';

export type UnlockBonusPayload = {
  referralId: string;
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(userConfigFactory.KEY)
    private readonly config: ConfigType<typeof userConfigFactory>,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter,
    private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly settingsService: SettingsService,
    private readonly referralsService: ReferralsService,
    private readonly walletsService: WalletsService,
    private readonly investmentsService: InvestmentsService,
    private readonly paymentsService: PaymentsService,
    private readonly walletTransactionService: WalletTransactionsService,
  ) {}

  async getById(userId: string): Promise<User> {
    return await this.prisma.user.findUniqueOrThrow({
      where: {
        id: userId,
      },
    });
  }

  async getMetaById(userId: string): Promise<UserMeta> {
    return await this.prisma.userMeta.findUniqueOrThrow({
      where: {
        userId,
      },
    });
  }

  async getByPublicId(publicId: string): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: {
        publicId,
      },
    });
  }

  async getByUsername(username: string): Promise<User | null> {
    return await this.prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive',
        },
      },
    });
  }

  async getCount(options?: {
    filters?: { status?: UserStatus };
  }): Promise<number> {
    return await this.prisma.user.count({
      where: {
        status: options?.filters?.status,
      },
    });
  }

  async getLanguageById(userId: string): Promise<Language> {
    const cache = await this.redisService.client.hget('users:locale', userId);
    if (cache) return cache as Language;

    const settings = await this.settingsService.getUserSettings(
      userId,
      'language',
    );

    let language: string | undefined;
    if (settings.length) {
      const selection = settings[0].selection as Prisma.JsonObject | null;
      language = selection?.value?.toString();
    }
    if (!language) {
      language = this.appConfig.defaultLanguage;
    }

    await this.redisService.client.hset('users:locale', userId, language);
    return language as Language;
  }

  async getAll(options?: {
    search?: string;
    skip?: number;
    take?: number;
    sortOrder?: Prisma.SortOrder;
  }): Promise<{
    count: number;
    skip: number;
    take: number;
    data: (User & {
      totalBonusAmount: Prisma.Decimal;
      totalEarnedProfit: Prisma.Decimal;
      totalInvestmentAmount: Prisma.Decimal;
      refferedUsersCount: number;
      referrer: Referrer | null;
    })[];
  }> {
    const where: Prisma.UserWhereInput = {};

    if (options?.search) {
      const search = options.search.trim().split(' ');
      if (search.length) {
        where.AND = [];

        for (const part of search) {
          where.AND.push({
            OR: [
              {
                firstname: {
                  contains: part,
                  mode: 'insensitive',
                },
              },
              {
                lastname: {
                  contains: part,
                  mode: 'insensitive',
                },
              },
              {
                username: {
                  contains: part,
                  mode: 'insensitive',
                },
              },
            ],
          });
        }
      } else {
        where.OR = [
          {
            firstname: {
              contains: options.search,
              mode: 'insensitive',
            },
          },
          {
            lastname: {
              contains: options.search,
              mode: 'insensitive',
            },
          },
          {
            username: {
              contains: options.search,
              mode: 'insensitive',
            },
          },
        ];
      }
    }

    const totalUsers = await this.prisma.user.count({
      where,
    });
    const users = await this.prisma.user.findMany({
      include: {
        meta: {
          select: {
            uplineId: true,
          },
        },
      },
      where,
      orderBy: { createdAt: options?.sortOrder || Prisma.SortOrder.desc },
      skip: options?.skip || 0,
      take: options?.take || 10,
    });

    const response = await Promise.all(
      users.map(async (user) => {
        if (!user.meta) {
          throw new Error('User meta not found');
        }

        const [
          totalEarnedProfit,
          refferedUsersCount,
          totalBonusAmount,
          totalInvestmentAmount,
          referrer,
        ] = await Promise.all([
          this.investmentsService.getTotalEarning({ userId: user.id }),
          this.referralsService.getReferredUsersCount(user.meta.uplineId),
          this.referralsService.getTotalBonusAmount({ userId: user.id }),
          this.investmentsService.getTotalAmount(user.id),
          this.referralsService.getReferrerOf(user.id),
        ]);

        this.utilsService.exclude(user.meta, ['uplineId']);

        return {
          ...user,
          totalEarnedProfit,
          totalBonusAmount,
          totalInvestmentAmount,
          refferedUsersCount,
          referrer: referrer || null,
        };
      }),
    );

    return {
      count: totalUsers,
      skip: options?.skip || 0,
      take: options?.take || 10,
      data: response,
    };
  }

  async updateLanguage(userId: string, languageId: string) {
    const settings = await this.settingsService.getUserSettings(
      userId,
      'language',
    );
    if (!settings.length) throw new Error('Unexpected error');

    await this.redisService.client.hdel('users:locale', userId);
    return await this.settingsService.updateUserSetting(
      userId,
      settings[0].id,
      undefined,
      languageId,
    );
  }

  async create(data: {
    publicId: string;
    firstname: string;
    lastname: string;
    username?: string;
  }): Promise<User> {
    return await this.prisma.$transaction(async (tx) => {
      const user = await this.prisma.user.create({
        data: {
          firstname: data.firstname,
          lastname: data.lastname,
          username: data.username || null,
          publicId: data.publicId,
          meta: {
            create: {
              uplineId: this.utilsService.generateRandomToken(8),
              referralCode: this.utilsService.generateRandomToken(8),
            },
          },
        },
      });
      await this.walletsService.create(user.id, { tx });
      return user;
    });
  }

  async getProfile(userId: string): Promise<
    User & {
      totalReferredUsers: number;
      lockedBonusAmount: Prisma.Decimal;
      totalBonusAmount: Prisma.Decimal;
      wallets: Wallet[];
      meta: Pick<UserMeta, 'referralCode'> | null;
    }
  > {
    const user = await this.prisma.user.findUniqueOrThrow({
      include: {
        meta: {
          select: {
            uplineId: true,
            referralCode: true,
          },
        },
      },
      where: {
        id: userId,
      },
    });

    const [totalReferredUsers, lockedBonusAmount, totalBonusAmount, wallets] =
      await Promise.all([
        user.meta
          ? this.referralsService.getReferredUsersCount(user.meta.uplineId)
          : 0,
        this.referralsService.getTotalBonusAmount({
          userId: user.id,
          isUnlocked: false,
        }),
        this.referralsService.getTotalBonusAmount({ userId: user.id }),
        this.walletsService.getAllByUserId(user.id),
      ]);

    return {
      ...user,
      wallets,
      totalReferredUsers,
      lockedBonusAmount,
      totalBonusAmount,
    };
  }

  async verifyProfile(userId: string): Promise<User> {
    return await this.prisma.user.update({
      data: {
        isVerified: true,
      },
      where: {
        id: userId,
      },
    });
  }

  async addBalance(data: {
    userId: string;
    paymentId: string;
    amount: number;
    fees: number;
    receivedAmount: number;
    amountInUsd: number;
    receivedAmountInUsd: number;
    priceInUsd: number;
    txidIn: string;
    txidOut: string;
  }): Promise<void> {
    const user = await this.getById(data.userId);
    const paymentWallet = await this.paymentsService.getWallet(data.userId);
    if (!paymentWallet) {
      throw new Error('Payment wallet not exist');
    }

    return await this.prisma.$transaction(async (tx) => {
      const payment = await this.paymentsService.create(
        {
          paymentId: data.paymentId,
          walletId: paymentWallet.id,
          amount: new Prisma.Decimal(data.amount).toDP(18),
          fees: new Prisma.Decimal(data.fees).toDP(18),
          receivedAmount: new Prisma.Decimal(data.receivedAmount).toDP(18),
          amountInUsd: new Prisma.Decimal(data.amountInUsd).toDP(2),
          receivedAmountInUsd: new Prisma.Decimal(
            data.receivedAmountInUsd,
          ).toDP(2),
          priceInUsd: new Prisma.Decimal(data.priceInUsd),
          txidIn: data.txidIn,
          txidOut: data.txidOut,
        },
        {
          tx,
        },
      );

      await this.walletsService.addBalance(
        data.userId,
        new Prisma.Decimal(data.amountInUsd).toDP(2),
        WalletType.Main,
        {
          tx,
          context: WalletTransactionContext.Deposit,
          entityId: payment.id,
        },
      );

      // Fire bot notification
      const event = new PaymentSuccessEvent(data.userId, user.publicId);
      this.eventEmitter.emit(PaymentSuccessEvent.eventName, event);
    });
  }

  async invest(
    userId: string,
    basketId: string,
    amount: number | Prisma.Decimal,
    tenure?: number,
  ): Promise<Investment> {
    if (!tenure) {
      tenure = 3;
    }
    if (typeof amount === 'number') {
      amount = new Prisma.Decimal(amount).toDP(2);
    }

    return await this.prisma.$transaction(async (tx) => {
      return await this.investmentsService.invest(
        userId,
        basketId,
        amount as Prisma.Decimal,
        tenure as number,
        new Date(),
        { tx },
      );
    });
  }

  async setAccountStatus(userId: string, status: UserStatus): Promise<User> {
    return await this.prisma.user.update({
      data: { status },
      where: {
        id: userId,
      },
    });
  }

  async setReferrerCode(userId: string, code: string): Promise<void> {
    const referrer = await this.referralsService.getReferrerByCode(code);
    if (!referrer) {
      throw new Error('Invalid referral code');
    }
    if (referrer.upline.length === this.config.uplineSize) {
      referrer.upline.pop();
    }

    const upline = _.takeRight(
      [referrer.uplineId, ...referrer.upline],
      this.config.uplineSize,
    ).join('.');

    const query = Prisma.sql`UPDATE user_meta SET upline = ${upline}::ltree WHERE user_id = ${userId}::uuid;`;
    await this.prisma.$queryRaw(query);
  }

  async getReferralStats(userId: string): Promise<ReferralStats> {
    const userMeta = await this.getMetaById(userId);
    return this.referralsService.getReferralStats(
      userMeta.uplineId,
      this.config.uplineSize,
    );
  }

  async getHierarchy(options?: {
    search?: string;
    filters?: { username?: string; level?: number };
    skip?: number;
    take?: number;
  }) {
    let uplineId: string | undefined;
    if (options?.filters?.username) {
      const user = await this.getByUsername(options.filters.username);
      if (user) {
        const userMeta = await this.getMetaById(user.id);
        uplineId = userMeta.uplineId;
      }
    }

    return await this.referralsService.getHierarchy({
      ...options,
      filters: { level: options?.filters?.level, uplineId },
    });
  }

  private async getTransactionNarration(
    context: UserType,
    tx: WalletTransaction & { wallet: { type: WalletType; user: User } },
  ): Promise<string> {
    let narration = '';
    if (tx.wallet.type === WalletType.Main) {
      if (
        tx.context === WalletTransactionContext.Deposit ||
        tx.context === WalletTransactionContext.Withdrawal ||
        tx.context === WalletTransactionContext.BonusWithdrawl
      ) {
        if (context === UserType.Admin) {
          narration = await this.walletTransactionService.narrationBuilder(tx, {
            userContext: context,
            walletType: tx.wallet.type,
            context: tx.context,
            user: tx.wallet.user,
          });
        }
      } else if (
        tx.context === WalletTransactionContext.Investment ||
        tx.context === WalletTransactionContext.TradeWithdrawl
      ) {
        if (context === UserType.Admin) {
          if (tx.entityId) {
            const investment = await this.investmentsService.getById(
              tx.entityId,
              tx.wallet.user.id,
            );
            const basket = await this.investmentsService.getBasketById(
              investment.basketId,
            );
            narration = await this.walletTransactionService.narrationBuilder(
              tx,
              {
                userContext: context,
                walletType: tx.wallet.type,
                context: tx.context,
                user: tx.wallet.user,
                investment: {
                  ...investment,
                  basket,
                },
              },
            );
          }
        }
      }
    } else if (tx.wallet.type === WalletType.Trade) {
      if (
        tx.context === WalletTransactionContext.Investment ||
        tx.context === WalletTransactionContext.Withdrawal
      ) {
        if (context === UserType.Admin) {
          if (tx.entityId) {
            const investment = await this.investmentsService.getById(
              tx.entityId,
              tx.wallet.user.id,
            );
            const basket = await this.investmentsService.getBasketById(
              investment.basketId,
            );

            narration = await this.walletTransactionService.narrationBuilder(
              tx,
              {
                userContext: context,
                walletType: tx.wallet.type,
                context: tx.context,
                user: tx.wallet.user,
                investment: {
                  ...investment,
                  basket,
                },
              },
            );
          }
        }
      } else if (tx.context === WalletTransactionContext.InvestmentEarning) {
        if (context === UserType.Admin) {
          if (tx.entityId) {
            const investmentEarning =
              await this.investmentsService.getEarningById(tx.entityId);
            const investment = await this.investmentsService.getById(
              investmentEarning.investmentId,
              tx.wallet.user.id,
            );
            const basket = await this.investmentsService.getBasketById(
              investment.basketId,
            );

            narration = await this.walletTransactionService.narrationBuilder(
              tx,
              {
                userContext: context,
                walletType: tx.wallet.type,
                context: tx.context,
                user: tx.wallet.user,
                investmentEarning: {
                  ...investmentEarning,
                  investment: {
                    ...investment,
                    basket,
                  },
                },
              },
            );
          }
        }
      }
    } else if (tx.wallet.type === WalletType.Bonus) {
      if (
        tx.context === WalletTransactionContext.Unlock ||
        tx.context === WalletTransactionContext.Withdrawal
      ) {
        if (context === UserType.Admin) {
          narration = await this.walletTransactionService.narrationBuilder(tx, {
            userContext: context,
            walletType: tx.wallet.type,
            context: tx.context,
            user: tx.wallet.user,
          });
        }
      } else if (tx.context === WalletTransactionContext.Investment) {
        if (context === UserType.Admin) {
          if (tx.entityId) {
            const referralBonus = await this.referralsService.getById(
              tx.entityId,
            );
            const referral = await this.getById(referralBonus.referralId);
            const investment = await this.investmentsService.getById(
              referralBonus.entityId,
              referralBonus.referralId,
            );
            const basket = await this.investmentsService.getBasketById(
              investment.basketId,
            );
            narration = await this.walletTransactionService.narrationBuilder(
              tx,
              {
                userContext: context,
                walletType: tx.wallet.type,
                context: tx.context,
                user: tx.wallet.user,
                referral,
                investment: {
                  ...investment,
                  basket,
                },
              },
            );
          }
        }
      }
    }

    return narration;
  }

  async getTransactions(
    context: UserType,
    options?: {
      filters?: {
        userId?: string;
        walletType?: WalletType;
        fromDate?: Date;
        toDate?: Date;
      };
      skip?: number;
      take?: number;
    },
  ) {
    const response = await this.walletTransactionService.getAll({
      filters: {
        userId: options?.filters?.userId,
        walletType: options?.filters?.walletType || WalletType.Main,
        fromDate: options?.filters?.fromDate,
        toDate: options?.filters?.toDate,
      },
      orderBy: 'createdAt',
      sortOrder: 'desc',
      skip: options?.skip,
      take: options?.take,
    });

    response.data = await Promise.all(
      response.data.map(async (tx) => {
        return {
          ...tx,
          narration: await this.getTransactionNarration(context, tx),
        };
      }),
    );

    return response;
  }
}
