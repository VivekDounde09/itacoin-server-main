import { ContractRunner } from 'ethers';
import {
  Chain,
  DevnetChain,
  MainnetChain,
  Network,
  NetworkChain,
  ProviderKind,
  TestnetChain,
} from '@Common';

export type ProviderKindDictionary = Partial<{ [Key in ProviderKind]: string }>;

export type NetworkAddressDictionary<T extends Chain> = Partial<{
  [key in NetworkChain<T>]: string;
}>;

export type NetworkSigningKeyDictionary<T extends Chain> = Partial<{
  [key in NetworkChain<T>]: string;
}>;

export type NetworkProviderDictionary<T extends Chain> = Partial<{
  [key in NetworkChain<T>]: ProviderKindDictionary;
}>;

export type AddressDictionary = Partial<{
  [Network.Devnet]: NetworkAddressDictionary<DevnetChain>;
  [Network.Testnet]: NetworkAddressDictionary<TestnetChain>;
  [Network.Mainnet]: NetworkAddressDictionary<MainnetChain>;
}>;

export type ProviderDictionary = Partial<{
  [Network.Devnet]: NetworkProviderDictionary<DevnetChain>;
  [Network.Testnet]: NetworkProviderDictionary<TestnetChain>;
  [Network.Mainnet]: NetworkProviderDictionary<MainnetChain>;
}>;

export type SigningKeyDictionary = Partial<{
  [Network.Devnet]: NetworkSigningKeyDictionary<DevnetChain>;
  [Network.Testnet]: NetworkSigningKeyDictionary<TestnetChain>;
  [Network.Mainnet]: NetworkSigningKeyDictionary<MainnetChain>;
}>;

export interface ContractFactory<T> {
  connect(address: string, runner?: ContractRunner | null): T;
}
