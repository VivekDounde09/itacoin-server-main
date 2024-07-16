import { registerAs } from '@nestjs/config';

export const distributeGrowthQueueConfigFactory = registerAs(
  'distributeGrowthQueue',
  () => ({
    concurrency: 1, // Do not increase this, because processor doesn't support parallel processing of jobs
    attempts: 10,
    batchSize: 1,
    delay: 86400000, // 24 hr
    removeCompletedAfter: 3600000, // 1 hr
  }),
);
