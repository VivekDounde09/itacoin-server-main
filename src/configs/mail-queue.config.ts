import { registerAs } from '@nestjs/config';

export const mailQueueConfigFactory = registerAs('mailQueue', () => ({
  concurrency: 5,
  removeCompletedAfter: 3600000, // 1 hr
  removeFailedAfter: 86400000, // 24 hr
}));
