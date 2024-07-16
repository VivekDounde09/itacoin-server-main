import { URL } from 'node:url';
import { firstValueFrom } from 'rxjs';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import CryptApi from '@cryptapi/api';
import { ethers } from 'ethers';
import { Payment, PaymentWallet, Prisma } from '@prisma/client';
import { UtilsService } from '@Common';
import { appConfigFactory, paymentConfigFactory } from '@Config';
import { PrismaService } from '../prisma';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(paymentConfigFactory.KEY)
    private readonly config: ConfigType<typeof paymentConfigFactory>,
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly utilsService: UtilsService,
  ) {}

  async get(paymentId: string): Promise<Payment | null> {
    return await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
  }

  async getWallet(
    payerId: string,
    token = 'bep20_usdt',
  ): Promise<PaymentWallet | null> {
    return await this.prisma.paymentWallet.findUnique({
      where: {
        payerId_token: {
          payerId,
          token,
        },
      },
    });
  }

  async getOrCreateWallet(payerId: string): Promise<PaymentWallet> {
    const wallet = await this.getWallet(payerId);
    if (wallet) {
      return wallet;
    }
    return await this.createWallet(payerId);
  }

  async getQRCode(
    address: string,
    value?: Prisma.Decimal,
    size = 512,
  ): Promise<string> {
    const query = new URLSearchParams({
      address,
      value: value ? value.toString() : '0',
      size: size.toString(),
    }).toString();

    return await this.utilsService
      .rerunnable(
        async () => {
          const response = await firstValueFrom(
            this.httpService.get<{
              status: string;
              qr_code: string;
              payment_uri: string;
            }>(`https://api.cryptapi.io/bep20/usdt/qrcode?${query}`),
          );
          if (response.data.status !== 'success') {
            throw new Error('Payment QR code not generated successfully');
          }
          return response.data.qr_code;
        },
        3,
        500,
      )
      .catch((err) => {
        console.error(err);
        throw new Error('Something went wrong with payment gateway');
      });
  }

  async createWallet(payerId: string): Promise<PaymentWallet> {
    if (!ethers.isAddress(this.config.receiverWalletAddress || '')) {
      throw new Error('Wallet address not found to receive payments');
    }

    const callbackUrl = new URL(
      `/users/${payerId}/payments/success`,
      this.appConfig.serverUrl,
    ).href;
    const token = 'bep20_usdt';
    const cryptApi = new CryptApi(
      token.replace('_', '/'),
      this.config.receiverWalletAddress,
      callbackUrl,
      {},
      { convert: 1 },
    );

    return await this.utilsService
      .rerunnable(
        async () => {
          const address = await cryptApi.getAddress();
          if (!address) {
            throw new Error(
              'Payment wallet address not generated successfully, found',
              address,
            );
          }

          return await this.prisma.paymentWallet.create({
            data: {
              token,
              address: address.toLowerCase(),
              receiverAddress: (
                this.config.receiverWalletAddress as string
              ).toLowerCase(),
              callbackUrl,
              payerId,
            },
          });
        },
        3,
        500,
      )
      .catch((err) => {
        console.error(err);
        throw new Error('Something went wrong with payment gateway');
      });
  }

  async create(
    data: {
      walletId: string;
      paymentId: string;
      amount: Prisma.Decimal;
      fees: Prisma.Decimal;
      receivedAmount: Prisma.Decimal;
      amountInUsd: Prisma.Decimal;
      receivedAmountInUsd: Prisma.Decimal;
      priceInUsd: Prisma.Decimal;
      txidIn: string;
      txidOut: string;
    },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Payment> {
    const client = options?.tx ? options.tx : this.prisma;

    return await client.payment.create({
      data: {
        id: data.paymentId,
        walletId: data.walletId,
        amount: data.amount,
        fees: data.fees,
        receivedAmount: data.receivedAmount,
        amountInUsd: data.amountInUsd,
        receivedAmountInUsd: data.receivedAmountInUsd,
        priceInUsd: data.priceInUsd,
        txidIn: data.txidIn.toLowerCase(),
        txidOut: data.txidOut.toLowerCase(),
      },
    });
  }
}
