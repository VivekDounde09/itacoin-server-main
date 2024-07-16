import { OnModuleInit, Logger } from '@nestjs/common';
import { OnQueueEvent, OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';

export abstract class BaseProcessor extends WorkerHost implements OnModuleInit {
  protected readonly logger;

  constructor(
    readonly name: string,
    private readonly concurrency: number,
  ) {
    super();
    this.logger = new Logger(name);
  }

  onModuleInit() {
    this.worker.concurrency = this.concurrency;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }

  @OnWorkerEvent('error')
  onWorkerError(err: Error): void {
    this.logger.error(err);
  }

  @OnQueueEvent('error')
  onQueueError(err: Error): void {
    this.logger.error(err);
  }
}
