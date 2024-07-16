import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Admin, AdminMeta, UserStatus } from '@prisma/client';
import { StorageService, UtilsService, ValidatedUser, UserType } from '@Common';
import { adminConfigFactory } from '@Config';
import { PrismaService } from '../prisma';
import { WalletsService } from '../wallets';
import { InvestmentsService } from '../investments';
import { ReferralsService } from '../referrals';
import { UsersService } from '../users';

@Injectable()
export class AdminService {
  constructor(
    @Inject(adminConfigFactory.KEY)
    private readonly config: ConfigType<typeof adminConfigFactory>,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly storageService: StorageService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly investmentsService: InvestmentsService,
    private readonly referralsService: ReferralsService,
  ) {}

  private hashPassword(password: string): { salt: string; hash: string } {
    const salt = this.utilsService.generateSalt(this.config.passwordSaltLength);
    const hash = this.utilsService.hashPassword(
      password,
      salt,
      this.config.passwordHashLength,
    );
    return { salt, hash };
  }

  async isEmailExist(email: string, excludeAdminId?: string): Promise<boolean> {
    return (
      (await this.prisma.admin.count({
        where: {
          email: email.toLowerCase(),
          NOT: {
            id: excludeAdminId,
          },
        },
      })) !== 0
    );
  }

  async getById(adminId: string): Promise<Admin> {
    return await this.prisma.admin.findUniqueOrThrow({
      where: {
        id: adminId,
      },
    });
  }

  async getByEmail(email: string): Promise<Admin | null> {
    return await this.prisma.admin.findUnique({
      where: {
        email: email.toLowerCase(),
      },
    });
  }

  async getMetaById(adminId: string): Promise<AdminMeta> {
    return await this.prisma.adminMeta.findUniqueOrThrow({
      where: {
        adminId,
      },
    });
  }

  async authenticate(adminId: string, password: string): Promise<Admin> {
    const admin = await this.getById(adminId);
    const validation = await this.validateCredentials(admin.email, password);

    if (!validation === null) throw new Error('Admin not found');
    if (validation === false) throw new Error('Incorrect password');

    return admin;
  }

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<ValidatedUser | false | null> {
    const admin = await this.getByEmail(email);
    if (!admin) return null;

    const adminMeta = await this.getMetaById(admin.id);
    const passwordHash = this.utilsService.hashPassword(
      password,
      adminMeta.passwordSalt || '',
      adminMeta.passwordHash
        ? adminMeta.passwordHash.length / 2
        : this.config.passwordHashLength,
    );

    if (adminMeta.passwordHash === passwordHash) {
      return {
        id: admin.id,
        type: UserType.Admin,
      };
    }

    return false;
  }

  getProfileImage(admin: Admin): string | null {
    if (admin.profileImage) {
      return this.storageService.getFileUrl(
        admin.profileImage,
        this.config.profileImagePath,
      );
    }
    return null;
  }

  async getProfile(adminId: string): Promise<Admin> {
    const admin = await this.getById(adminId);
    admin.profileImage = this.getProfileImage(admin);
    return admin;
  }

  async updateProfileDetails(
    adminId: string,
    firstname?: string,
    lastname?: string,
    email?: string,
  ): Promise<Admin> {
    if (email && (await this.isEmailExist(email, adminId)))
      throw new Error('Email already exist');

    return await this.prisma.admin.update({
      data: {
        firstname,
        lastname,
        email: email && email.toLowerCase(),
      },
      where: {
        id: adminId,
      },
    });
  }

  async updateProfileImage(
    adminId: string,
    profileImage: string,
  ): Promise<{ profileImage: string | null }> {
    const admin = await this.getById(adminId);

    // Remove current profile image from storage
    if (admin.profileImage) {
      const profilePath = `${this.config.profileImagePath}/${admin.profileImage}`;
      if (await this.storageService.exist(profilePath)) {
        await this.storageService.removeFile(profilePath);
      }
    }

    await this.storageService.move(profileImage, this.config.profileImagePath);
    const updatedAdmin = await this.prisma.admin.update({
      where: { id: adminId },
      data: { profileImage },
    });

    return {
      profileImage: this.getProfileImage(updatedAdmin),
    };
  }

  async changePassword(
    adminId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<Admin> {
    const admin = await this.getById(adminId);
    const adminMeta = await this.getMetaById(admin.id);

    const hashedPassword = this.utilsService.hashPassword(
      oldPassword,
      adminMeta.passwordSalt || '',
      adminMeta.passwordHash
        ? adminMeta.passwordHash.length / 2
        : this.config.passwordHashLength,
    );

    if (hashedPassword !== adminMeta.passwordHash)
      throw new Error('Password does not match');

    const { salt, hash } = this.hashPassword(newPassword);
    const passwordSalt = salt;
    const passwordHash = hash;

    await this.prisma.adminMeta.update({
      data: {
        passwordHash,
        passwordSalt,
      },
      where: {
        adminId,
      },
    });
    return admin;
  }

  async getStats(options?: { fromDate?: Date; toDate?: Date }) {
    const [
      activeUsers,
      currentMainWalletAmount,
      tradeAmount,
      unlockedBonusAmount,
      lockedBonusAmount,
    ] = await Promise.all([
      this.usersService.getCount({ filters: { status: UserStatus.Active } }),
      this.walletsService.getTotalMainAmount(),
      this.investmentsService.getTotalTradeAmount({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      }),
      this.referralsService.getTotalBonusAmount({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
        isUnlocked: true,
      }),
      this.referralsService.getTotalBonusAmount({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
        isUnlocked: false,
      }),
    ]);

    return {
      activeUsers,
      currentMainWalletAmount,
      tradeAmount,
      unlockedBonusAmount,
      lockedBonusAmount,
    };
  }
}
