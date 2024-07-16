import { registerAs } from '@nestjs/config';
import { Environment, Network } from '@Common';

export const appConfigFactory = registerAs('app', () => ({
  env: process.env.APP_ENV as Environment,
  network: process.env.NETWORK as Network,
  domain: process.env.DOMAIN,
  adminWebUrl: process.env.ADMIN_WEB_URL,
  serverUrl: process.env.SERVER_URL,
  platformName: process.env.PLATFORM_NAME,
  httpPayloadMaxSize: '20mb',
  defaultLanguage: 'en',
}));
