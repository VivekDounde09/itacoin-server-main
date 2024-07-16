import { registerAs } from '@nestjs/config';

export const investmentConfigFactory = registerAs('investment', () => ({
  minimumDateToSwitch: 1,
  maximumDateToSwitch: 5,
  growthStartDate: 1,
  basketSwitchDuration: 172800000, // 48 hrs
}));
