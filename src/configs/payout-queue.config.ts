import { registerAs } from '@nestjs/config';

export const payoutQueueConfigFactory = registerAs('payoutQueue', () => ({
  concurrency: 1, // Do not increase this, because processor doesn't support parallel processing of jobs
  attempts: 3,
  removeCompletedAfter: 3600000, // 1 hr
}));
