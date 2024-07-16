import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { PrismaModule } from '../prisma';
import { WalletTransactionsModule } from '../wallet-transactions';

@Module({
  imports: [PrismaModule, WalletTransactionsModule],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
