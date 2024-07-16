import { registerAs } from '@nestjs/config';
import { DevnetChain, MainnetChain, TestnetChain } from '@Common';

export const payoutVaultConfigFactory = registerAs('payoutVault', () => ({
  addressDictionary: {
    devnet: {
      local: process.env.DEVNET_LOCAL_PAYOUT_VAULT_ADDRESS,
    },
    mainnet: {
      binance: process.env.MAINNET_BINANCE_PAYOUT_VAULT_ADDRESS,
    },
    testnet: {
      binance_testnet: process.env.TESTNET_BINANCE_PAYOUT_VAULT_ADDRESS,
    },
  },
  defaultChain: {
    devnet: DevnetChain.Local,
    mainnet: MainnetChain.Binance,
    testnet: TestnetChain.BinanceTestnet,
  },
}));
