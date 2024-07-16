import { Prisma } from '@prisma/client';

export const investmentBaskets: Prisma.InvestmentBasketCreateInput[] = [
  {
    tier: 0,
    minAmount: 10,
    maxAmount: 499,
  },
  {
    tier: 1,
    minAmount: 500,
    maxAmount: 2499,
  },
  {
    tier: 2,
    minAmount: 2500,
    maxAmount: 9999,
  },
  {
    tier: 3,
    minAmount: 10000,
    maxAmount: null,
  },
];
