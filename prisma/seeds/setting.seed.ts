import { Prisma, SettingContext, SettingType } from '@prisma/client';

export const settings: Prisma.SettingCreateInput[] = [
  {
    context: SettingContext.User,
    mappedTo: 'language',
    text: 'Bot reply language',
    description: 'Language in which bot will reply',
    type: SettingType.SingleSelect,
    isDefinedOptions: true,
    default: 'en',
    options: {
      createMany: {
        data: [
          { text: 'English', value: 'en' },
          { text: 'Italian', value: 'it' },
        ],
      },
    },
  },
  {
    context: SettingContext.System,
    mappedTo: 'withdraw.resolveTime',
    text: 'Withdraw requests resolve time',
    description: 'Withdraw requests resolve time in GMT timezone',
    type: SettingType.SingleSelect,
    isDefinedOptions: false,
    default: '01:00', // In 24 Hr format
  },
  {
    context: SettingContext.System,
    mappedTo: 'withdraw.batchCeaseBefore',
    text: 'Cease withdraw requests batch before resolve time',
    description: 'Cease withdraw requests batch before resolve time in Hrs',
    type: SettingType.SingleSelect,
    isDefinedOptions: false,
    default: '12',
  },
];
