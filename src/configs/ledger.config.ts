import { registerAs } from '@nestjs/config';

export const ledgerConfigFactory = registerAs('ledger', () => ({
  provider: {
    devnet: {
      local: {
        http: process.env.DEVNET_LOCAL_HTTP_PROVIDER,
        ws: process.env.DEVNET_LOCAL_WS_PROVIDER,
      },
    },
    mainnet: {
      binance: {
        http: process.env.MAINNET_BINANCE_HTTP_PROVIDER,
        ws: process.env.MAINNET_BINANCE_WS_PROVIDER,
      },
    },
    testnet: {
      binance_testnet: {
        http: process.env.TESTNET_BINANCE_HTTP_PROVIDER,
        ws: process.env.TESTNET_BINANCE_WS_PROVIDER,
      },
    },
  },
  defaultSigningKey: process.env.SIGNING_KEY,
  signingKey: {
    devnet: {
      local: process.env.DEVNET_LOCAL_SIGNING_KEY,
    },
    mainnet: {
      binance: process.env.MAINNET_BINANCE_SIGNING_KEY,
    },
    testnet: {
      binance_testnet: process.env.TESTNET_BINANCE_SIGNING_KEY,
    },
  },
}));
