import { Inject, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import {
  Prisma,
  ReferralBonus,
  ReferralBonusType,
  User,
  UserStatus,
  WalletTransactionContext,
  WalletType,
} from '@prisma/client';
import { ConfigType } from '@nestjs/config';
import { UtilsService } from '@Common';
import { referralConfigFactory } from '@Config';
import { PrismaService } from '../prisma';
import { WalletsService } from '../wallets';

export type ReferralStats = {
  totalUsers: number;
  levels: { level: number; users: number; earning: number }[];
};
export type Referrer = User & { uplineId: string; upline: string[] };
export type RawReferrer = {
  id: string;
  public_id: string;
  firstname: string;
  lastname: string;
  username: string;
  is_verified: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  upline_id: string;
  upline: string | null;
};
type CreatePayload = {
  type: ReferralBonusType;
  userId: string;
  referralId: string;
  entityId: string;
  amount: Prisma.Decimal;
  percent: number;
  level: number;
};

@Injectable()
export class ReferralsService {
  constructor(
    @Inject(referralConfigFactory.KEY)
    private readonly config: ConfigType<typeof referralConfigFactory>,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly walletsService: WalletsService,
  ) {}

  private getReferrerFromRaw(rawReferrer: RawReferrer): Referrer {
    return {
      id: rawReferrer.id,
      publicId: rawReferrer.public_id,
      firstname: rawReferrer.firstname,
      lastname: rawReferrer.lastname,
      username: rawReferrer.username,
      isVerified: rawReferrer.is_verified,
      status: this.utilsService.toEnumValue<UserStatus>(rawReferrer.status),
      createdAt: rawReferrer.created_at,
      updatedAt: rawReferrer.updated_at,
      uplineId: rawReferrer.upline_id,
      upline: rawReferrer.upline ? rawReferrer.upline.split('.') : [],
    };
  }

  async getById(referralBonusId: string): Promise<ReferralBonus> {
    return await this.prisma.referralBonus.findUniqueOrThrow({
      where: { id: referralBonusId },
    });
  }

  async isBonusUnlocked(referrerJoinedAt: Date): Promise<boolean> {
    if (
      dayjs().diff(dayjs(referrerJoinedAt), 'days') >
      this.config.daysToUnlockBonus
    ) {
      return true;
    }
    return false;
  }

  private async getBonusUnlockTime(referrerJoinedAt: Date): Promise<Date> {
    const daysSinceReferrerJoined = dayjs().diff(
      dayjs(referrerJoinedAt),
      'days',
    );

    if (daysSinceReferrerJoined > this.config.daysToUnlockBonus) {
      return new Date();
    } else {
      return dayjs()
        .add(this.config.daysToUnlockBonus - daysSinceReferrerJoined, 'days')
        .startOf('day')
        .toDate();
    }
  }

  private async create(
    data: CreatePayload,
    options: { tx: Prisma.TransactionClient },
  ): Promise<ReferralBonus> {
    const client = options.tx;
    const referrer = await this.getReferrerById(data.userId);
    const isUnlocked = await this.isBonusUnlocked(referrer.createdAt);
    const referralBonus = await client.referralBonus.create({
      data: {
        ...data,
        isUnlocked,
        unlockedAt: isUnlocked
          ? new Date()
          : await this.getBonusUnlockTime(referrer.createdAt),
      },
    });
    if (isUnlocked) {
      await this.walletsService.addBalance(
        data.userId,
        data.amount,
        WalletType.Bonus,
        {
          tx: options.tx,
          context: WalletTransactionContext.Investment,
          entityId: referralBonus.id,
        },
      );
    }

    return referralBonus;
  }

  async createInvestmentBonus(
    userId: string,
    referralId: string,
    investmentId: string,
    investmentAmount: Prisma.Decimal,
    options: { tx: Prisma.TransactionClient },
  ): Promise<ReferralBonus> {
    const amount = investmentAmount
      .mul(this.config.investmentBonus)
      .div(100)
      .toDP(2);
    return await this.create(
      {
        type: ReferralBonusType.Investment,
        userId,
        referralId,
        entityId: investmentId,
        amount,
        percent: this.config.investmentBonus,
        level: 1,
      },
      { tx: options.tx },
    );
  }

  // TODO: Need to fix data inconsistency issue
  async unlockBonuses() {
    let offset = 0;
    let referralEarnings: { userId: string; amount: Prisma.Decimal }[] = [];
    do {
      const response = await this.prisma.referralBonus.groupBy({
        by: 'userId',
        _sum: {
          amount: true,
        },
        where: {
          isUnlocked: false,
          unlockedAt: {
            gte: new Date(),
          },
        },
        orderBy: {
          userId: Prisma.SortOrder.asc,
        },
        skip: offset,
        take: this.config.unlockBonusBatchSize,
      });

      offset += this.config.unlockBonusBatchSize;
      referralEarnings = response.map((data) => ({
        userId: data.userId,
        amount: data._sum.amount || new Prisma.Decimal(0),
      }));

      await this.prisma.$transaction(async (tx) => {
        await Promise.all(
          referralEarnings.map(async (data) => {
            await this.walletsService.addBalance(
              data.userId,
              data.amount,
              WalletType.Bonus,
              { tx, context: WalletTransactionContext.Unlock },
            );
            await tx.referralBonus.updateMany({
              data: {
                isUnlocked: true,
              },
              where: {
                userId: data.userId,
                isUnlocked: false,
                unlockedAt: {
                  gte: new Date(),
                },
              },
            });
          }),
        );
      });
    } while (referralEarnings.length === this.config.unlockBonusBatchSize);
  }

  async hasLockedBonus(
    userId: string,
    level?: number,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<boolean> {
    const client = options?.tx ? options.tx : this.prisma;
    return (
      (await client.referralBonus.count({
        where: {
          userId,
          isUnlocked: false,
          level,
        },
      })) !== 0
    );
  }

  async getReferredUsersCount(
    uplineId: string,
    level = 1,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<number> {
    const client = options?.tx ? options.tx : this.prisma;
    const uplineMatchLabel = `*{${level - 1}}.${uplineId}.*`;
    const getReferredUsersCountQuery = Prisma.sql`SELECT COUNT(*) FROM user_meta WHERE upline::ltree ~ ${uplineMatchLabel}::lquery;`;
    const response = await client.$queryRaw<{ count: bigint }[]>(
      getReferredUsersCountQuery,
    );
    if (response.length) {
      return Number(response[0].count);
    }
    return 0;
  }

  async getReferrerById(referrerId: string): Promise<Referrer> {
    const response = await this.prisma.$queryRaw<RawReferrer[]>(
      Prisma.sql`SELECT u.*, um.upline, um.upline_id FROM public.user u INNER JOIN public.user_meta um ON u.id = um.user_id WHERE u.id = ${referrerId}::UUID`,
    );
    if (!response.length) {
      throw new Error(`Referrer does not exist with id ${referrerId}`);
    }
    return this.getReferrerFromRaw(response[0]);
  }

  async getReferrerByCode(referralCode: string): Promise<Referrer> {
    const response = await this.prisma.$queryRaw<RawReferrer[]>(
      Prisma.sql`SELECT u.*, um.upline, um.upline_id FROM public.user u INNER JOIN public.user_meta um ON u.id = um.user_id WHERE um.referral_code = ${referralCode}`,
    );
    if (!response.length) {
      throw new Error(
        `Referrer does not exist with referral code ${referralCode}`,
      );
    }
    return this.getReferrerFromRaw(response[0]);
  }

  async getUplineById(userId: string): Promise<string[]> {
    const query = Prisma.sql`SELECT upline FROM user_meta WHERE user_id = ${userId}::UUID;`;
    const response = await this.prisma.$queryRaw<{ upline: string }[]>(query);
    if (!response.length) {
      throw new Error('User meta does not exist');
    }
    return response[0].upline ? response[0].upline.split('.') : [];
  }

  async getReferrerByUplineId(uplineId: string): Promise<Referrer> {
    const response = await this.prisma.$queryRaw<RawReferrer[]>(
      Prisma.sql`SELECT u.*, um.upline, um.upline_id FROM public.user u INNER JOIN public.user_meta um ON u.id = um.user_id WHERE um.upline_id = ${uplineId}`,
    );
    if (!response.length) {
      throw new Error(`Referrer does not exist with upline id ${uplineId}`);
    }
    return this.getReferrerFromRaw(response[0]);
  }

  async getReferrerOf(userId: string): Promise<Referrer | null> {
    const response = await this.prisma.$queryRaw<{ upline: string }[]>(
      Prisma.sql`SELECT um.upline FROM public.user_meta um WHERE um.user_id = ${userId}::UUID`,
    );
    if (!response.length) {
      throw new Error(`User does not exist`);
    }
    const upline = response[0].upline ? response[0].upline.split('.') : [];
    return upline.length ? this.getReferrerByUplineId(upline[0]) : null;
  }

  async getUplineUsersOf(userId: string): Promise<Referrer[]> {
    const response = await this.prisma.$queryRaw<{ upline: string }[]>(
      Prisma.sql`SELECT um.upline FROM public.user_meta um WHERE um.user_id = ${userId}::UUID`,
    );
    if (!response.length) {
      throw new Error(`User does not exist`);
    }
    const upline = response[0].upline ? response[0].upline.split('.') : [];
    const referrers: Referrer[] = [];
    if (!upline.length) {
      return referrers;
    }

    return await Promise.all(
      upline.map(async (uplineId) => {
        return await this.getReferrerByUplineId(uplineId);
      }),
    );
  }

  async getTotalBonusAmount(options?: {
    userId?: string;
    level?: number;
    isUnlocked?: boolean;
    fromDate?: Date;
    toDate?: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<Prisma.Decimal> {
    const client = options?.tx ? options.tx : this.prisma;
    const where: Prisma.ReferralBonusWhereInput = {
      isUnlocked: options?.isUnlocked,
      userId: options?.userId,
      level: options?.level,
    };
    if (options?.fromDate && options.toDate) {
      where.createdAt = {
        gte: options.fromDate,
        lte: options.toDate,
      };
    }

    const response = await client.referralBonus.aggregate({
      _sum: {
        amount: true,
      },
      where,
    });
    return response._sum.amount || new Prisma.Decimal(0);
  }

  async getReferralStats(
    uplineId: string,
    uplineSize: number,
  ): Promise<ReferralStats> {
    const uplineMatchLabel = `*.${uplineId}.*`;
    const getReferredUsersUplineQuery = Prisma.sql`SELECT upline, user_id FROM user_meta WHERE upline::ltree ~ ${uplineMatchLabel}::lquery;`;
    const referredUsersUplineData = await this.prisma.$queryRaw<
      { upline: string; user_id: string }[]
    >(getReferredUsersUplineQuery);

    const defaultLevelValue = () => ({
      level: -1,
      users: 0,
      earning: 0,
    });
    const levels: ReturnType<typeof defaultLevelValue>[] = [];

    let maxLevel = -1;

    for (let i = 0; i < referredUsersUplineData.length; i++) {
      const upline = referredUsersUplineData[i].upline.split('.');
      const level = upline.indexOf(uplineId);
      if (level === -1) throw new Error('Index underflow');
      if (maxLevel < level) maxLevel = level;
      if (!levels[level]) {
        levels[level] = defaultLevelValue();
      }
      levels[level].level = level + 1;
      levels[level].users++;
    }

    if (maxLevel < uplineSize) {
      const diff = uplineSize - (maxLevel + 1);
      for (let i = 0; i < diff; i++) {
        levels.push(defaultLevelValue());
        levels[levels.length - 1].level = levels.length;
      }
    }

    for (let i = 0; i < levels.length; i++) {
      if (!levels[i]) {
        levels[i] = defaultLevelValue();
        levels[i].level = i + 1;
      }
    }

    const earningMap: Record<string, number> = {};

    const getAllLevelsEarningQuery = Prisma.sql`SELECT rb.level, COALESCE(SUM(rb.amount), 0)::DECIMAL(12,2) AS earning FROM referral_bonus rb INNER JOIN user_meta um ON rb.user_id = um.user_id AND um.upline_id = ${uplineId} GROUP BY rb.level;`;
    const allLevelsEarningData = await this.prisma.$queryRaw<
      { level: number; earning: number }[]
    >(getAllLevelsEarningQuery);
    allLevelsEarningData.forEach((i) => (earningMap[i.level] = i.earning));

    for (let i = 0; i < levels.length; i++) {
      if (earningMap[levels[i].level]) {
        levels[i].earning = earningMap[levels[i].level];
      }
    }

    return {
      totalUsers: referredUsersUplineData.length,
      levels,
    };
  }

  async getHierarchy(options?: {
    search?: string;
    filters?: { uplineId?: string; level?: number };
    skip?: number;
    take?: number;
  }) {
    let uplineMatchLabel: string | undefined;
    let level: number | undefined;

    if (options?.filters?.uplineId) {
      level = options?.filters?.level || 1;
      const uplineId = options.filters.uplineId;
      uplineMatchLabel = `*{${level - 1}}.${uplineId}.*`;
    } else {
      level = options?.filters?.level || 0;
    }

    const search = options?.search || '';
    const where = Prisma.sql`WHERE TRUE
      ${
        uplineMatchLabel
          ? Prisma.sql`AND um.upline::ltree ~ ${uplineMatchLabel}::lquery`
          : Prisma.sql`AND COALESCE(cardinality(string_to_array(upline::text, '.')), 0) = ${level}`
      }
      AND CONCAT(u.firstname, ' ', u.lastname, ' ', u.username) ILIKE ${`%${search}%`}
    `;
    const query = Prisma.sql`SELECT u.id, u.firstname, u.lastname, u.username, u.created_at AS joined_at, um.upline_id
      FROM public.user u 
      INNER JOIN user_meta um 
      ON u.id = um.user_id
      ${where}
      ORDER BY u.created_at
      LIMIT ${options?.take || 10}
      OFFSET ${options?.skip || 0}
    ;`;

    const response = await this.prisma.$queryRaw<
      {
        id: string;
        firstname: string;
        lastname: string;
        username: string;
        joined_at: Date;
        upline_id: string;
      }[]
    >(query);

    const totalUsersCountResponse = await this.prisma.$queryRaw<
      { count: bigint }[]
    >(
      Prisma.sql`SELECT COUNT(*) FROM public.user u INNER JOIN user_meta um ON u.id = um.user_id ${where}`,
    );

    const users = await Promise.all(
      response.map(async (user) => {
        const [refferedUsersCount, totalBonusAmount] = await Promise.all([
          this.getReferredUsersCount(user.upline_id),
          this.getTotalBonusAmount({ userId: user.id }),
        ]);
        return {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          username: user.username,
          joinedAt: user.joined_at,
          uplineId: user.upline_id,
          refferedUsersCount,
          totalBonusAmount,
        };
      }),
    );

    return {
      count: totalUsersCountResponse.length
        ? Number(totalUsersCountResponse[0].count)
        : 0,
      skip: options?.skip || 0,
      take: options?.take || 10,
      data: users,
    };
  }
}
