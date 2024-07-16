import { registerAs } from '@nestjs/config';

export const referralConfigFactory = registerAs('referral', () => ({
  investmentBonus: 2,
  daysToUnlockBonus: 90,
  unlockBonusBatchSize: 25,
}));
