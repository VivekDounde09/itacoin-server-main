import { ethers } from 'ethers';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  Chain,
  DevnetChain,
  EnvironmentVariables,
  ProviderKind,
} from '@Common';
import { payoutVaultConfigFactory } from '@Config';
import { BaseContract } from './base.contract';
import { PayoutVault, PayoutVault__factory } from './typechain';
import { AddressDictionary, ContractFactory } from '../ledger.types';
import { LedgerService } from '../ledger.service';

@Injectable()
export class PayoutVaultContract
  extends BaseContract<PayoutVault, ContractFactory<PayoutVault>>
  implements OnModuleInit
{
  constructor(
    @Inject(payoutVaultConfigFactory.KEY)
    readonly config: ConfigType<typeof payoutVaultConfigFactory>,
    readonly configService: ConfigService<EnvironmentVariables, true>,
    readonly ledgerService: LedgerService,
  ) {
    super(
      PayoutVault__factory,
      config.addressDictionary as AddressDictionary,
      configService.get('NETWORK', { infer: true }),
      ledgerService,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  subscribeEvents(contract: PayoutVault, chain: Chain): void {}

  async payout(
    address: string,
    amount: Prisma.Decimal,
    chain?: Chain,
  ): Promise<ethers.ContractTransactionReceipt | null> {
    if (!chain) {
      chain = this.config.defaultChain[this.network];
    }
    if (chain === DevnetChain.Local) {
      return null;
    }

    const provider = this.ledgerService.getProvider(chain, ProviderKind.Http);
    const signer = this.ledgerService.getSigner(chain);
    const contract = this.getInstance(chain, signer.connect(provider));

    return LedgerService.sendTransaction(async () => {
      const tx = await contract.withdraw(
        address,
        ethers.parseEther(amount.toString()),
      );
      return (await tx.wait()) as ethers.ContractTransactionReceipt;
    });
  }
}
