import path from 'path';
import * as bodyParser from 'body-parser';
import { ConfigService, ConfigType } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import {
  AllExceptionsFilter,
  EnvironmentVariables,
  UtilsService,
} from '@Common';
import { appConfigFactory } from '@Config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const utilsService = app.get(UtilsService);
  const appConfig = app.get<ConfigType<typeof appConfigFactory>>(
    appConfigFactory.KEY,
  );

  app.use(bodyParser.json({ limit: appConfig.httpPayloadMaxSize }));
  app.use(
    bodyParser.urlencoded({
      limit: appConfig.httpPayloadMaxSize,
      extended: true,
    }),
  );
  const origins = appConfig.domain
    ? [
        new RegExp(`^http[s]{0,1}://${appConfig.domain}$`),
        new RegExp(`^http[s]{0,1}://[a-z-]+.${appConfig.domain}$`),
      ]
    : [];

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
      stopAtFirstError: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  app.enableCors({
    origin: utilsService.isProduction()
      ? origins
      : [/^http:\/\/localhost:[0-9]+$/, ...origins],
    credentials: true,
  });
  app.use(cookieParser());
  app.use(
    helmet.crossOriginResourcePolicy({
      policy: utilsService.isProduction() ? 'same-site' : 'cross-origin',
    }),
  );
  app.enableShutdownHooks();
  app.useStaticAssets(
    path.join(process.cwd(), configService.get('STORAGE_DIR')),
    { prefix: `/${configService.get('STORAGE_DIR')}` },
  );

  await app.listen(configService.get('PORT'));

  // Send messages to the parent process if server spawned with an IPC channel
  if (process.send) {
    process.send('ready');
  }

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at: Promise', { promise, reason });
  });
}
bootstrap();
