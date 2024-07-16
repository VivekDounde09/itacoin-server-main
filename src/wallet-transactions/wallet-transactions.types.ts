import {
  User,
  Investment,
  InvestmentBasket,
  InvestmentEarning,
  WalletTransactionContext,
  WalletType,
} from '@prisma/client';
import { UserType } from '@Common';

type BaseContextMeta =
  | { userContext: typeof UserType.Admin; user: User }
  | { userContext: typeof UserType.User };

type DepositContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.Deposit;
  walletType: typeof WalletType.Main;
};

type InvestmentContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.Investment;
  investment: Investment & { basket: InvestmentBasket };
} & (
    | {
        walletType: typeof WalletType.Main | typeof WalletType.Trade;
      }
    | { walletType: typeof WalletType.Bonus; referral: User }
  );

type InvestmentEarningContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.InvestmentEarning;
  walletType: WalletType;
  investmentEarning: InvestmentEarning & {
    investment: Investment & { basket: InvestmentBasket };
  };
};

type UnlockContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.Unlock;
  walletType: WalletType;
};

type WithdrawalContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.Withdrawal;
} & (
    | { walletType: typeof WalletType.Main | typeof WalletType.Bonus }
    | {
        walletType: typeof WalletType.Trade;
        investment: Investment & { basket: InvestmentBasket };
      }
  );

type TradeWithdrawlContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.TradeWithdrawl;
  walletType: WalletType;
  investment: Investment & { basket: InvestmentBasket };
};

type BonusWithdrawlContextMeta = BaseContextMeta & {
  context: typeof WalletTransactionContext.BonusWithdrawl;
  walletType: WalletType;
};

export type WalletTransactionContextMeta =
  | DepositContextMeta
  | InvestmentContextMeta
  | InvestmentEarningContextMeta
  | UnlockContextMeta
  | WithdrawalContextMeta
  | TradeWithdrawlContextMeta
  | BonusWithdrawlContextMeta;
