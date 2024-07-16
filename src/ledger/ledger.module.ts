import { Module } from '@nestjs/common';
import * as contracts from './contracts';
import { LedgerService } from './ledger.service';
import { PrismaModule } from '../prisma';

@Module({
  imports: [PrismaModule],
  providers: [LedgerService, ...Object.values(contracts)],
  exports: [LedgerService, ...Object.values(contracts)],
})
export class LedgerModule {}
