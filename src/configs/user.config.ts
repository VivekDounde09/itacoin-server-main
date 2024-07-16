import { registerAs } from '@nestjs/config';

export const userConfigFactory = registerAs('user', () => ({
  uplineSize: 1,
}));
