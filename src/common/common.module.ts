import Redis from 'ioredis';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import * as configs from '@Config';
import { validateEnvironmentVariables } from './utils';
import { MailService, StorageService, UtilsService } from './providers';
import { MailProcessor } from './processors';
import { JwtStrategy } from './strategies';
import { MAIL_QUEUE } from './common.constants';

const providers = [MailService, StorageService, UtilsService, JwtStrategy];

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: Object.values(configs),
      validate: validateEnvironmentVariables,
    }),
    BullModule.registerQueue({
      name: MAIL_QUEUE,
      connection: new Redis(process.env.REDIS_URI as string, {
        maxRetriesPerRequest: null,
      }),
    }),
  ],
  providers: [...providers, MailProcessor],
  exports: providers,
})
export class CommonModule {}
