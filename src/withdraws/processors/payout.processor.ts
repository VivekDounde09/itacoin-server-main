import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { ContractTransactionReceipt } from 'ethers';
import { WalletType, WithdrawStatus } from '@prisma/client';
import { BaseProcessor, UtilsService } from '@Common';
import { payoutQueueConfigFactory } from '@Config';
import { PAYOUT_QUEUE } from '../withdraws.constants';
import { PayoutPayload, WithdrawsService } from '../withdraws.service';
import { WalletsService } from '../../wallets';
import { PayoutVaultContract } from '../../ledger';

@Processor(PAYOUT_QUEUE)
export class PayoutProcessor extends BaseProcessor {
  constructor(
    @Inject(payoutQueueConfigFactory.KEY)
    readonly config: ConfigType<typeof payoutQueueConfigFactory>,
    private readonly utilsService: UtilsService,
    private readonly withdrawsService: WithdrawsService,
    private readonly walletsService: WalletsService,
    private readonly payoutVaultContract: PayoutVaultContract,
  ) {
    super(PayoutProcessor.name, config.concurrency);
  }

  async process(job: Job<PayoutPayload, ContractTransactionReceipt | null>) {
    const { withdrawId } = job.data;

    const withdraw = await this.withdrawsService.getPendingById(withdrawId);
    if (!withdraw) return;

    const mainWallet = await this.walletsService.getByUserId(
      withdraw.userId,
      WalletType.Main,
    );
    if (mainWallet.amount.lessThan(withdraw.amount)) {
      throw new Error('Insufficient balance in main wallet to withdraw');
    }

    const receipt = await this.payoutVaultContract.payout(
      withdraw.address,
      withdraw.amount,
    );

    await this.utilsService.rerunnable(
      async () => {
        await this.withdrawsService.updateOnPayout({
          withdrawId: withdraw.id,
          status: WithdrawStatus.Processed,
          txhash: receipt?.hash,
        });
      },
      3,
      1500,
    );

    return receipt;
  }
}
