import { OnModuleInit } from '@nestjs/common';
import { Chain, Network, ProviderKind } from '@Common';
import { BaseContract as Contract, ContractRunner, ethers } from 'ethers';
import {
  AddressDictionary,
  ContractFactory,
  NetworkAddressDictionary,
} from '../ledger.types';
import { LedgerService } from '../ledger.service';

export abstract class BaseContract<
  T extends Contract,
  V extends ContractFactory<T>,
> implements OnModuleInit
{
  constructor(
    protected readonly factory: V,
    protected readonly addressDictionary: AddressDictionary,
    protected readonly network: Network,
    protected readonly ledgerService: LedgerService,
  ) {}

  onModuleInit() {
    this.init();
  }

  abstract subscribeEvents(contract: T, chain: Chain): void;

  getInstance(chain: Chain, runner: ContractRunner): T {
    return this.factory.connect(this.getAddress(chain), runner);
  }

  getAddress(chain: Chain, strict = true): string {
    if (strict && typeof this.addressDictionary !== 'object') {
      throw new Error(
        `Invalid address dictionary, found ${typeof this
          .addressDictionary} expected object`,
      );
    }

    if (strict && typeof this.addressDictionary[this.network] !== 'object') {
      throw new Error(`Address not configured for network ${this.network}`);
    }

    if (
      typeof this.addressDictionary === 'object' &&
      typeof this.addressDictionary[this.network] === 'object'
    ) {
      const networkAddressDictionary = this.addressDictionary[
        this.network
      ] as NetworkAddressDictionary<Chain>;

      if (
        strict &&
        (typeof networkAddressDictionary[chain] !== 'string' ||
          !ethers.isAddress(networkAddressDictionary[chain]))
      ) {
        throw new Error(
          `Invalid address for chain ${chain} on network ${this.network}, found ${networkAddressDictionary[chain]}`,
        );
      }

      return networkAddressDictionary[chain] || ethers.ZeroAddress;
    }

    return ethers.ZeroAddress;
  }

  private init() {
    if (
      typeof this.addressDictionary === 'object' &&
      typeof this.addressDictionary[this.network] === 'object'
    ) {
      const networkAddressDictionary = this.addressDictionary[
        this.network
      ] as NetworkAddressDictionary<Chain>;

      for (const [chain, address] of Object.entries(networkAddressDictionary)) {
        if (
          typeof address === 'string' &&
          ethers.isAddress(address) &&
          address !== ethers.ZeroAddress
        ) {
          const provider = this.ledgerService.getProvider(
            chain as Chain,
            ProviderKind.Ws,
          );

          const contract = this.getInstance(chain as Chain, provider);

          this.subscribeEvents(contract, chain as Chain);
          // Reconnect after 5 minutes
          setTimeout(async () => {
            await provider.removeAllListeners();
            this.init();
          }, 300000);
        }
      }
    }
  }
}
