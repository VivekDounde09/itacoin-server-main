import { Module } from '@nestjs/common';
import { WalletTransactionsService } from './wallet-transactions.service';
import { PrismaModule } from '../prisma';

@Module({
  imports: [PrismaModule],
  providers: [WalletTransactionsService],
  exports: [WalletTransactionsService],
})
export class WalletTransactionsModule {}
