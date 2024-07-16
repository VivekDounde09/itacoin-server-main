import { registerAs } from '@nestjs/config';

export const paymentConfigFactory = registerAs('payment', () => ({
  receiverWalletAddress: process.env.PAYMENT_RECEIVER_WALLET_ADDRESS,
}));
