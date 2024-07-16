import { Logger } from '@nestjs/common';

export abstract class BaseService {
  protected readonly logger;

  constructor(name: string) {
    this.logger = new Logger(name);
  }
}
