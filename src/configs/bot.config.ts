import { registerAs } from '@nestjs/config';

export const botConfigFactory = registerAs('bot', () => ({
  telegramBotApiToken: process.env.TELEGRAM_BOT_API_TOKEN,
}));
