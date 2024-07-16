import _ from 'lodash';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Setting,
  SettingContext,
  SettingOption,
  SettingType,
  SystemSetting,
  UserSetting,
} from '@prisma/client';
import { JsonArray } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async upsertUserSetting(
    userId: string,
    settingId: number,
    selection: Prisma.InputJsonValue,
  ): Promise<UserSetting> {
    return await this.prisma.userSetting.upsert({
      where: {
        userId_settingId: {
          userId,
          settingId,
        },
      },
      update: { selection },
      create: {
        selection,
        userId,
        settingId,
      },
    });
  }

  private async upsertSystemSetting(
    settingId: number,
    selection: Prisma.InputJsonValue,
  ): Promise<SystemSetting> {
    return await this.prisma.systemSetting.upsert({
      where: {
        settingId,
      },
      update: { selection },
      create: {
        selection,
        settingId,
      },
    });
  }

  private mapSelectionsToOption(
    selection: Prisma.JsonValue,
    options: SettingOption[],
  ): Prisma.JsonValue[] {
    const selections: Prisma.JsonValue[] = [];
    if (selection) {
      (selection as JsonArray).forEach((selection) => {
        const option = _.find(options, (option) => option.id === selection);
        if (option) {
          selections.push(option);
        }
      });
    }
    return selections;
  }

  private mapSettings(
    allSettings: (Setting & {
      options: SettingOption[];
    })[],
    contextSettings: (UserSetting | SystemSetting)[],
  ): (Setting & {
    options: SettingOption[];
    selection: Prisma.JsonValue | null;
  })[] {
    // TODO: Need to map user settings with sub settings
    return allSettings.map((setting) => {
      const contextSetting = _.find(
        contextSettings,
        (contextSetting) => contextSetting.settingId === setting.id,
      );
      if (!contextSetting) {
        return { ...setting, selection: null };
      }

      if (
        setting.type === SettingType.SingleSelect &&
        setting.isDefinedOptions
      ) {
        const option = _.find(
          setting.options,
          (option) => option.id === contextSetting.selection,
        );
        return { ...setting, selection: option || null };
      }

      if (
        setting.type === SettingType.MultiSelect &&
        setting.isDefinedOptions
      ) {
        return {
          ...setting,
          selection: this.mapSelectionsToOption(
            contextSetting.selection,
            setting.options,
          ),
        };
      }

      return { ...setting, selection: contextSetting.selection };
    });
  }

  async getById(settingId: number) {
    // TODO: Need to add sub settings using recursion strategy
    return await this.prisma.setting.findUniqueOrThrow({
      include: {
        options: true,
      },
      where: { id: settingId },
    });
  }

  async getAll(
    context: SettingContext,
    options?: {
      mappedTo?: string;
    },
  ) {
    // TODO: Need to add sub settings using recursion strategy
    return await this.prisma.setting.findMany({
      include: {
        options: true,
      },
      where: {
        context,
        parentId: null,
        mappedTo: options?.mappedTo
          ? { contains: options.mappedTo, mode: 'insensitive' }
          : undefined,
      },
    });
  }

  async getUserSettings(userId: string, mappedTo?: string) {
    const allSettings = await this.getAll(SettingContext.User, {
      mappedTo,
    });
    const userSettings = await this.prisma.userSetting.findMany({
      where: {
        userId,
        settingId: {
          in: allSettings.map((s) => s.id),
        },
      },
    });
    return this.mapSettings(allSettings, userSettings);
  }

  async getSystemSettings(mappedTo?: string) {
    const allSettings = await this.getAll(SettingContext.System, {
      mappedTo,
    });
    const systemSettings = await this.prisma.systemSetting.findMany({
      where: {
        settingId: {
          in: allSettings.map((s) => s.id),
        },
      },
    });
    return this.mapSettings(allSettings, systemSettings);
  }

  async updateUserSetting(
    userId: string,
    settingId: number,
    enable?: boolean,
    selection?: string,
    selections?: string[],
  ): Promise<UserSetting> {
    const setting = await this.getById(settingId);
    if (setting.type === SettingType.Binary && typeof enable === 'boolean') {
      return await this.upsertUserSetting(userId, settingId, enable);
    }

    if (
      setting.type === SettingType.SingleSelect &&
      typeof selection === 'string'
    ) {
      if (setting.isDefinedOptions) {
        const settingOptions = setting.options;

        if (!_.some(settingOptions, { id: Number(selection) })) {
          throw new Error('Invalid setting option selection');
        }

        return await this.upsertUserSetting(
          userId,
          settingId,
          Number(selection),
        );
      } else {
        // TODO: Need to handle dynamic setting options
      }
    }

    if (
      setting.type === SettingType.MultiSelect &&
      selections instanceof Array
    ) {
      if (setting.isDefinedOptions) {
        const settingOptions = setting.options;

        selections.forEach((selection) => {
          if (!_.some(settingOptions, { id: Number(selection) })) {
            throw new Error('Invalid setting option selection');
          }
        });

        return await this.upsertUserSetting(
          userId,
          settingId,
          selections.map((selection) => Number(selection)),
        );
      } else {
        // TODO: Need to handle dynamic setting options
      }
    }

    throw new Error('Unknown error');
  }

  async updateSystemSetting(
    settingId: number,
    enable?: boolean,
    selection?: string,
    selections?: string[],
  ): Promise<SystemSetting> {
    const setting = await this.getById(settingId);
    if (setting.type === SettingType.Binary && typeof enable === 'boolean') {
      return await this.upsertSystemSetting(settingId, enable);
    }

    if (
      setting.type === SettingType.SingleSelect &&
      typeof selection === 'string'
    ) {
      if (setting.isDefinedOptions) {
        const settingOptions = setting.options;

        if (!_.some(settingOptions, { id: Number(selection) })) {
          throw new Error('Invalid setting option selection');
        }

        return await this.upsertSystemSetting(settingId, Number(selection));
      } else {
        // TODO: Need to handle dynamic setting options
      }
    }

    if (
      setting.type === SettingType.MultiSelect &&
      selections instanceof Array
    ) {
      if (setting.isDefinedOptions) {
        const settingOptions = setting.options;

        selections.forEach((selection) => {
          if (!_.some(settingOptions, { id: Number(selection) })) {
            throw new Error('Invalid setting option selection');
          }
        });

        return await this.upsertSystemSetting(
          settingId,
          selections.map((selection) => Number(selection)),
        );
      } else {
        // TODO: Need to handle dynamic setting options
      }
    }

    throw new Error('Unknown error');
  }
}
