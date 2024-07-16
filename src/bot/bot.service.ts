import path from 'path';
import fs from 'fs/promises';
import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import dayjs from 'dayjs';
import qs from 'qs';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import { ConfigType } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import * as svgCaptcha from 'svg-captcha';
import sharp from 'sharp';
import {
  InvestmentStatus,
  Prisma,
  SettingContext,
  User,
  WalletTransactionContext,
  WalletType,
} from '@prisma/client';
import {
  ArgType,
  Language,
  UtilsService,
  TransformArgs,
  StorageService,
} from '@Common';
import { appConfigFactory, botConfigFactory } from '@Config';
import {
  InvestmentArgsDto,
  InvestmentPhase,
  InvestmentWithdrawArgsDto,
  InvestmentWithdrawPhase,
  WithdrawArgsDto,
  WithdrawPhase,
} from './dto';
import { UsersService } from '../users';
import { SettingsService } from '../settings';
import { RedisService } from '../redis';
import { WalletsService } from '../wallets';
import { PaymentsService } from '../payments';
import { InvestmentsService } from '../investments';
import { WithdrawsService } from '../withdraws';
import { ReferralsService } from '../referrals';
import { PrismaService } from '../prisma';

type Context = {
  userId: string;
  publicId: string;
  chatId: string;
  lang: Language;
  reply: (
    keyOrText: string,
    options?: (
      | TelegramBot.SendMessageOptions
      | TelegramBot.EditMessageTextOptions
    ) & { args?: object; editMessageId?: number; isText?: boolean },
  ) => Promise<TelegramBot.Message | boolean>;
};
type QueryHandler = (msg: TelegramBot.Message, args?: object) => Promise<void>;

enum BotState {
  AwaitingInvestmentAmount = 'awaitingInvestmentAmount',
  AwaitingWithdrawAmount = 'awaitingWithdrawAmount',
  AwaitingWithdrawWalletAddress = 'awaitingWithdrawWalletAddress',
  AwaitingWithdrawReferralBonusAmount = 'awaitingWithdrawReferralBonusAmount',
  AwaitingVerificationCode = 'awaitingVerificationCode',
  AwaitingReferralCode = 'awaitingReferralCode',
}

@Injectable()
export class BotService implements OnModuleInit, OnApplicationShutdown {
  private readonly bot: TelegramBot;

  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(botConfigFactory.KEY)
    private readonly config: ConfigType<typeof botConfigFactory>,
    private readonly i18n: I18nService,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly storageService: StorageService,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly redisService: RedisService,
    private readonly walletsService: WalletsService,
    private readonly paymentsService: PaymentsService,
    private readonly investmentsService: InvestmentsService,
    private readonly withdrawsService: WithdrawsService,
    private readonly referralsService: ReferralsService,
  ) {
    this.bot = new TelegramBot(this.config.telegramBotApiToken || '', {
      polling: true,
    });
  }

  async onModuleInit() {
    await this.initialize();
  }

  async onApplicationShutdown() {
    await this.bot.stopPolling();
  }

  private replyMethodGenerator(chatId: string, lang: Language) {
    return async (
      keyOrText: string,
      options?: (
        | TelegramBot.SendMessageOptions
        | TelegramBot.EditMessageTextOptions
      ) & {
        args?: object;
        editMessageId?: number;
        isText?: boolean;
      },
    ) => {
      const { args, editMessageId, ...messageOptions } = options || {};

      if (editMessageId) {
        return await this.bot.editMessageText(
          options?.isText ? keyOrText : this.i18n.t(keyOrText, { args, lang }),
          {
            chat_id: chatId,
            message_id: editMessageId,
            ...(messageOptions as TelegramBot.EditMessageTextOptions),
          },
        );
      } else {
        return await this.bot.sendMessage(
          chatId,
          options?.isText ? keyOrText : this.i18n.t(keyOrText, { args, lang }),
          messageOptions as TelegramBot.SendMessageOptions,
        );
      }
    };
  }

  private async getUser(publicId: string): Promise<User & { lang: Language }> {
    const user = await this.usersService.getByPublicId(publicId);
    if (!user) throw new Error('User not found');

    const lang = await this.usersService.getLanguageById(user.id);
    return {
      ...user,
      lang,
    };
  }

  private async createContext(args: {
    publicId: string;
    chatId: string;
  }): Promise<Context> {
    const user = await this.getUser(args.publicId);

    return {
      userId: user.id,
      publicId: user.publicId,
      chatId: args.chatId,
      lang: user.lang,
      reply: this.replyMethodGenerator(args.chatId, user.lang),
    };
  }

  private async getContext(msg: TelegramBot.Message): Promise<Context> {
    if (!msg.from) throw new Error('Telegram user does not exist');
    return this.createContext({
      publicId: msg.from.id.toString(),
      chatId: msg.chat.id.toString(),
    });
  }

  private callbackBuilder(
    handler: QueryHandler | string,
    args?: Record<string, unknown>,
  ): string {
    return `${
      typeof handler === 'string' ? handler : handler.name
    }:${qs.stringify(args)}`;
  }

  private async callPhaseHandler(
    phase: number,
    handlers: (() => Promise<void>)[],
  ): Promise<void> {
    if (phase >= handlers.length) {
      throw new Error('Unknown phase handler execution');
    }
    return await handlers[phase]();
  }

  private async getLanguageOptionsReplyInlineKeyboard(
    lang: Language,
  ): Promise<TelegramBot.InlineKeyboardButton[][]> {
    const settings = await this.settingsService.getAll(SettingContext.User, {
      mappedTo: 'language',
    });
    if (!settings.length) throw new Error('Unexpected error');

    const options = settings[0].options;
    return options.map((option) => [
      {
        text: this.i18n.t(`bot.language.${option.value}`, { lang }),
        callback_data: this.callbackBuilder(this.setLanguageHandler, {
          languageId: option.id,
        }),
      },
    ]);
  }

  private getPersistentReplyInlineKeyboard(lang: Language) {
    return {
      keyboard: [
        [
          { text: this.i18n.t('bot.keyboard.persistent.0', { lang }) },
          { text: this.i18n.t('bot.keyboard.persistent.1', { lang }) },
        ],
        [
          { text: this.i18n.t('bot.keyboard.persistent.2', { lang }) },
          { text: this.i18n.t('bot.keyboard.persistent.3', { lang }) },
        ],
      ],
      is_persistent: true,
      resize_keyboard: true,
      one_time_keyboard: false,
    };
  }

  private async initialize(): Promise<void> {
    this.bot.on('message', this.messageHandler.bind(this));
    this.bot.on('callback_query', this.callbackQueryHandler.bind(this));
  }

  private async messageHandler(msg: TelegramBot.Message): Promise<void> {
    const messageText = msg.text || '';

    if (messageText === '/start' && !msg.from?.is_bot) {
      return await this.startHandler(msg);
    }
    if (/⚙️ (Settings|Impostazioni)/.test(messageText)) {
      return await this.settingsHandler(msg);
    }
    if (/💼 (Personal account|Account personale)/.test(messageText)) {
      return await this.accountHandler(msg);
    }
    if (/💰 (Deposit|Deposito)/.test(messageText)) {
      return await this.topupHandler(msg);
    }
    if (/🏧 (Withdraw|Prelievo)/.test(messageText)) {
      return await this.withdrawHandler(msg);
    }
    return await this.botStateHandler(msg);
  }

  private async callbackQueryHandler(
    query: TelegramBot.CallbackQuery,
  ): Promise<void> {
    if (!query.message) return;

    const [handler, data] = query.data?.split(':') || [];
    return await (this[handler as keyof this] as QueryHandler).bind(this)(
      { ...query.message, from: query.from },
      qs.parse(data),
    );
  }

  private async startHandler(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from) return;

    try {
      const publicId = msg.from.id.toString();
      const user = await this.usersService.getByPublicId(publicId);
      if (!user) {
        await this.usersService.create({
          publicId: publicId,
          firstname: msg.chat.first_name || '',
          lastname: msg.chat.last_name || '',
          username: msg.chat.username,
        });
        const lang = this.appConfig.defaultLanguage as Language;
        await this.bot.sendMessage(
          msg.chat.id.toString(),
          this.i18n.t('bot.language.select', {
            lang,
          }),
          {
            reply_markup: {
              inline_keyboard: await this.getLanguageOptionsReplyInlineKeyboard(
                lang,
              ),
            },
          },
        );
      } else {
        const ctx = await this.getContext(msg);
        await this.sendWelcomeMessage(ctx);
      }
    } catch (err) {
      await this.bot.sendMessage(msg.chat.id.toString(), err.message);
    }
  }

  private async accountHandler(
    msg: TelegramBot.Message,
    args?: { editMessageId?: number },
  ) {
    const { lang, publicId, userId, reply } = await this.getContext(msg);

    try {
      const [
        user,
        wallets,
        totalInvestments,
        completedInvestments,
        activeInvestments,
        withdrewAmount,
        totalInvestmentAmount,
      ] = await Promise.all([
        this.usersService.getById(userId),
        this.walletsService.getAllByUserId(userId),
        this.investmentsService.getCount({ userId }),
        this.investmentsService.getCount({
          userId,
          status: InvestmentStatus.Closed,
        }),
        this.investmentsService.getCount({
          userId,
          status: InvestmentStatus.Active,
        }),
        this.withdrawsService.getProcessedAmountOf(userId),
        this.investmentsService.getTotalAmount(userId),
      ]);
      const mainWallet = wallets.find(
        (wallet) => wallet.type === WalletType.Main,
      );

      reply('bot.account.info', {
        editMessageId: args?.editMessageId,
        args: {
          isVerified: user.isVerified ? '✅' : '❌',
          mainBalance: mainWallet ? mainWallet.amount.toString() : '0.00',
          publicId,
          totalInvestments,
          completedInvestments,
          activeInvestments,
          withdrewAmount,
          totalInvestmentAmount,
        },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: this.i18n.t('bot.keyboard.account.0', { lang }),
                callback_data: this.callbackBuilder(this.topupHandler),
              },
              {
                text: this.i18n.t('bot.keyboard.account.1', { lang }),
                callback_data: this.callbackBuilder('investmentHandler'),
              },
            ],
            [
              {
                text: this.i18n.t('bot.keyboard.account.2', { lang }),
                callback_data: this.callbackBuilder(this.portfolioHandler),
              },
              {
                text: this.i18n.t('bot.keyboard.account.3', { lang }),
                callback_data: this.callbackBuilder(this.verificationHandler),
              },
            ],
            [
              {
                text: this.i18n.t('bot.keyboard.account.4', { lang }),
                callback_data: this.callbackBuilder(this.referralHandler),
              },
            ],
          ],
        },
      });
    } catch (err) {
      await reply(err.message);
    }
  }

  private async settingsHandler(msg: TelegramBot.Message) {
    const { lang, reply } = await this.getContext(msg);
    await reply('bot.language.change', {
      reply_markup: {
        inline_keyboard: await this.getLanguageOptionsReplyInlineKeyboard(lang),
      },
    });
  }

  private async botStateHandler(msg: TelegramBot.Message): Promise<void> {
    const ctx = await this.getContext(msg);
    const state = await this.redisService.client.hget('bot:state', ctx.chatId);
    if (!state) return;

    switch (state) {
      case BotState.AwaitingInvestmentAmount:
        await this.investmentHandler(msg);
        break;
      case BotState.AwaitingWithdrawAmount:
      case BotState.AwaitingWithdrawWalletAddress:
        await this.withdrawHandler(msg);
        break;
      case BotState.AwaitingWithdrawReferralBonusAmount:
        await this.referralBonusWithdrawHandler(msg);
        break;
      case BotState.AwaitingVerificationCode:
        await this.verificationHandler(msg);
        break;
      case BotState.AwaitingReferralCode:
        await this.setReferralCodeHandler(msg);
        break;
      default:
        break;
    }
  }

  private async sendWelcomeMessage(ctx: Context): Promise<void> {
    const { lang, reply } = ctx;
    const options = {
      reply_markup: this.getPersistentReplyInlineKeyboard(lang),
    };

    await reply('bot.greeting', options);
  }

  private async setLanguageHandler(
    msg: TelegramBot.Message,
    args: { languageId: string },
  ) {
    const { userId, reply } = await this.getContext(msg);

    try {
      await this.usersService.updateLanguage(userId, args.languageId);
      // Send msg with new language context
      await this.sendWelcomeMessage(await this.getContext(msg));
    } catch (err) {
      await reply(err.message);
    }
  }

  private async topupHandler(msg: TelegramBot.Message) {
    const { chatId, userId, lang, reply } = await this.getContext(msg);
    try {
      const waitMsg = (await reply('bot.payment.wait')) as TelegramBot.Message;
      const paymentWallet = await this.paymentsService.getOrCreateWallet(
        userId,
      );
      const qrCode = await this.paymentsService.getQRCode(
        paymentWallet.address,
        new Prisma.Decimal('0'),
        360,
      );
      const imgBuffer = await sharp(Buffer.from(qrCode, 'base64'))
        .png()
        .toBuffer();
      const filePath = path.join(
        this.storageService.diskDestination,
        `${paymentWallet.id}.png`,
      );

      await fs.writeFile(filePath, imgBuffer);
      await this.bot.deleteMessage(chatId, waitMsg.message_id);
      await this.bot.sendPhoto(
        chatId,
        filePath,
        {
          caption: this.i18n.t('bot.payment.payInfo', {
            lang,
            args: {
              wallet: paymentWallet.address,
            },
          }),
        },
        { filename: `${paymentWallet.id}.png`, contentType: 'image/png' },
      );
    } catch (err) {
      await reply(err.message);
    }
  }

  @TransformArgs()
  private async withdrawHandler(
    msg: TelegramBot.Message,
    @ArgType(WithdrawArgsDto) args?: WithdrawArgsDto,
  ) {
    const { publicId, userId, chatId, lang, reply } = await this.getContext(
      msg,
    );
    if (!args) args = new WithdrawArgsDto();

    try {
      const state = await this.redisService.client.hget('bot:state', chatId);
      if (state === BotState.AwaitingWithdrawAmount) {
        args.phase = WithdrawPhase.ValidateAndTakeWalletInput;
      } else if (state === BotState.AwaitingWithdrawWalletAddress) {
        args.phase = WithdrawPhase.ValidateAndTakeAcknowledgement;
      } else if (!args.phase) {
        args.phase = WithdrawPhase.TakeAmountInput;
      }

      if (args.phase > WithdrawPhase.ValidateAndTakeWalletInput) {
        const [amount] = await this.redisService.client.hmget(
          `bot:user:${publicId}:withdraw-state`,
          'amount',
        );
        if (!amount) {
          throw new Error('Withdraw amount not found');
        }
        args.amount = Number(amount);
      }

      if (args.phase > InvestmentPhase.ValidateAndTakeAcknowledgement) {
        const [address] = await this.redisService.client.hmget(
          `bot:user:${publicId}:withdraw-state`,
          'address',
        );
        if (!address) {
          throw new Error('Wallet address not found');
        }
        args.address = address;
      }

      const withdrawableAmount =
        await this.walletsService.getUseableMainBalanceOf(userId);

      await this.callPhaseHandler(args.phase, [
        // Phase TakeAmountInput
        async () => {
          await this.redisService.client.hset(
            'bot:state',
            chatId,
            BotState.AwaitingWithdrawAmount,
          );
          await reply('bot.account.action.withdraw', {
            args: { withdrawableAmount },
          });
        },
        // Phase ValidateAndTakeWalletInput
        async () => {
          // Validate input
          if (!/^[0-9]+$/.test(msg.text || '')) {
            await reply('bot.withdraw.invalidAmount');
            return;
          }

          // Validate amount
          const amount = new Prisma.Decimal(msg.text || 0).toDP(2);
          if (amount.lessThanOrEqualTo(0)) {
            await reply('bot.withdraw.minAmountError');
            return;
          }
          if (amount.greaterThan(withdrawableAmount)) {
            await reply('bot.withdraw.maxAmountError', {
              args: { amount: withdrawableAmount },
            });
            return;
          }

          await Promise.all([
            this.redisService.client.hset(
              'bot:state',
              chatId,
              BotState.AwaitingWithdrawWalletAddress,
            ),
            this.redisService.client.hmset(
              `bot:user:${publicId}:withdraw-state`,
              { amount },
            ),
          ]);
          await reply('bot.withdraw.action.putWalletAddress');
        },
        // Phase ValidateAndTakeAcknowledgement
        async () => {
          // Validate input
          if (!ethers.isAddress(msg.text || '')) {
            await reply('bot.withdraw.invalidWalletAddress');
            return;
          }

          const address = ethers.getAddress(msg.text as string);

          await this.redisService.client.hmset(
            `bot:user:${publicId}:withdraw-state`,
            { address },
          );
          await reply('bot.withdraw.action.acknowledged', {
            args: {
              amount: args?.amount,
              address,
            },
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: this.i18n.t('bot.keyboard.acknowledged.0', { lang }),
                    callback_data: this.callbackBuilder('withdrawHandler', {
                      phase: InvestmentPhase.Proceed,
                      acknowledged: true,
                    }),
                  },
                  {
                    text: this.i18n.t('bot.keyboard.acknowledged.1', { lang }),
                    callback_data: this.callbackBuilder('withdrawHandler', {
                      phase: InvestmentPhase.Proceed,
                      acknowledged: false,
                    }),
                  },
                ],
              ],
            },
          });

          // Reset state
          await this.redisService.client.hdel('bot:state', chatId);
        },
        // Phase Proceed
        async () => {
          if (args?.acknowledged) {
            const withdrawRequest = await this.withdrawsService.create(
              userId,
              args.address as string,
              args.amount as number,
            );

            await reply('bot.withdraw.action.confirmed', {
              editMessageId: msg.message_id,
              args: {
                expectedTime: dayjs(withdrawRequest.expectedTime).format(
                  'MMM DD, YYYY, hh:mm A',
                ),
              },
            });
          } else {
            await reply('bot.withdraw.action.denied', {
              editMessageId: msg.message_id,
            });
          }
          await this.redisService.client.del(
            `bot:user:${publicId}:withdraw-state`,
          );
        },
      ]);
    } catch (err) {
      await reply(err.message);
    }
  }

  @TransformArgs()
  private async investmentHandler(
    msg: TelegramBot.Message,
    @ArgType(InvestmentArgsDto) args?: InvestmentArgsDto,
  ) {
    const { publicId, userId, chatId, lang, reply } = await this.getContext(
      msg,
    );
    if (!args) args = new InvestmentArgsDto();

    try {
      const state = await this.redisService.client.hget('bot:state', chatId);
      if (state === BotState.AwaitingInvestmentAmount) {
        args.phase = InvestmentPhase.ValidateAndTakeAcknowledgement;
      } else if (!args.phase) {
        args.phase = InvestmentPhase.Initial;
      }

      if (args.phase > InvestmentPhase.TakeAmountInput) {
        const [tier] = await this.redisService.client.hmget(
          `bot:user:${publicId}:investment-state`,
          'tier',
        );
        if (!tier) {
          throw new Error('Investment tier not found');
        }
        args.tier = Number(tier);
      }

      if (args.phase > InvestmentPhase.ValidateAndTakeAcknowledgement) {
        const [amount] = await this.redisService.client.hmget(
          `bot:user:${publicId}:investment-state`,
          'amount',
        );
        if (!amount) {
          throw new Error('Investment amount not found');
        }
        args.amount = Number(amount);
      }

      await this.callPhaseHandler(args.phase, [
        // Phase Initial
        async () => {
          const baskets = await this.investmentsService.getAllBaskets();

          await reply('bot.investment.basketsInfo', {
            editMessageId: msg.message_id,
            reply_markup: {
              inline_keyboard: [
                baskets.map((basket, index) => ({
                  text: this.i18n.t(`bot.investment.baskets.${index}`, {
                    lang,
                  }),
                  callback_data: this.callbackBuilder('investmentHandler', {
                    phase: InvestmentPhase.TakeAmountInput,
                    tier: basket.tier,
                  }),
                })),
                [
                  {
                    text: this.i18n.t('bot.keyboard.goBack', { lang }),
                    callback_data: this.callbackBuilder(this.accountHandler, {
                      editMessageId: msg.message_id,
                    }),
                  },
                ],
              ],
            },
          });
        },
        // Phase TakeAmountInput
        async () => {
          await Promise.all([
            this.redisService.client.hset(
              'bot:state',
              chatId,
              BotState.AwaitingInvestmentAmount,
            ),
            this.redisService.client.hmset(
              `bot:user:${publicId}:investment-state`,
              {
                tier: args?.tier,
              },
            ),
          ]);
          await reply('bot.investment.action.invest');
        },
        // Phase ValidateAndTakeAcknowledgement
        async () => {
          // Validate input
          if (!/^[0-9]+$/.test(msg.text || '')) {
            await reply('bot.investment.invalidAmount');
            return;
          }

          // Validate amount
          const amount = new Prisma.Decimal(msg.text || 0).toDP(2);
          const baskets = await this.investmentsService.getAllBaskets();
          const basket = baskets.find((basket) => basket.tier === args?.tier);
          if (!basket) {
            throw new Error('Investment basket not found');
          }
          if (amount.lessThan(basket.minAmount)) {
            await reply('bot.investment.minAmountError', {
              args: { amount: basket.minAmount },
            });
            return;
          }
          if (basket.maxAmount && amount.greaterThan(basket.maxAmount)) {
            await reply('bot.investment.maxAmountError', {
              args: { amount: basket.maxAmount },
            });
            return;
          }

          const currentMainBalance =
            await this.walletsService.getUseableMainBalanceOf(userId);
          if (currentMainBalance.lessThan(amount)) {
            await reply('bot.investment.topup', {
              args: { topupAmount: amount.sub(currentMainBalance) },
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: this.i18n.t('bot.keyboard.account.0', { lang }),
                      callback_data: this.callbackBuilder(this.topupHandler),
                    },
                  ],
                ],
              },
            });

            await this.redisService.client.del(
              `bot:user:${publicId}:investment-state`,
            );
          } else {
            await this.redisService.client.hmset(
              `bot:user:${publicId}:investment-state`,
              { amount },
            );
            await reply('bot.investment.action.acknowledged', {
              args: {
                investmentAmount: amount,
                plan: this.i18n.t(`bot.investment.baskets.${args?.tier}`, {
                  lang,
                }),
              },
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: this.i18n.t('bot.keyboard.acknowledged.0', {
                        lang,
                      }),
                      callback_data: this.callbackBuilder('investmentHandler', {
                        phase: InvestmentPhase.Proceed,
                        acknowledged: true,
                      }),
                    },
                    {
                      text: this.i18n.t('bot.keyboard.acknowledged.1', {
                        lang,
                      }),
                      callback_data: this.callbackBuilder('investmentHandler', {
                        phase: InvestmentPhase.Proceed,
                        acknowledged: false,
                      }),
                    },
                  ],
                ],
              },
            });
          }

          // Reset state
          await this.redisService.client.hdel('bot:state', chatId);
        },
        // Phase Proceed
        async () => {
          if (args?.acknowledged) {
            const baskets = await this.investmentsService.getAllBaskets();
            const basket = baskets.find((basket) => basket.tier === args?.tier);
            if (!basket) {
              throw new Error('Investment basket not found');
            }

            await this.usersService.invest(
              userId,
              basket.id,
              new Prisma.Decimal(args?.amount || 0).toDP(2),
            );
            await reply('bot.investment.action.confirmed', {
              editMessageId: msg.message_id,
            });
          } else {
            await reply('bot.investment.action.denied', {
              editMessageId: msg.message_id,
            });
          }
          await this.redisService.client.del(
            `bot:user:${publicId}:investment-state`,
          );
        },
      ]);
    } catch (err) {
      await reply(err.message);
    }
  }

  private async portfolioHandler(
    msg: TelegramBot.Message,
    args?: { editMessageId?: number },
  ) {
    const { userId, lang, reply } = await this.getContext(msg);

    try {
      const investments = await this.investmentsService.getAll({
        filters: { userId, status: InvestmentStatus.Active },
      });

      const portfolio = await this.investmentsService.getPortfolioByUserId(
        userId,
      );

      let messageText = this.i18n.t('bot.portfolio.info', {
        args: {
          tierOneInvestmentAmount: portfolio[0].investedAmount,
          tierTwoInvestmentAmount: portfolio[1].investedAmount,
          tierThreeInvestmentAmount: portfolio[2].investedAmount,
        },
        lang,
      });

      if (investments.length) {
        for (const investment of investments) {
          messageText += this.i18n.t('bot.portfolio.card', {
            args: {
              portfolioId: investment.portfolioId,
              plan: this.i18n.t(
                `bot.investment.baskets.${investment.basket.tier}`,
                {
                  lang,
                },
              ),
              initialAmount: investment.initialAmount,
              currentAmount: investment.amount,
              investmentDate: dayjs(investment.createdAt).format(
                'MMM DD, YYYY',
              ),
            },
            lang,
          });
        }
      } else {
        messageText += this.i18n.t('bot.portfolio.notFound', { lang });
      }

      await reply(messageText, {
        isText: true,
        editMessageId: args?.editMessageId || msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: this.i18n.t('bot.keyboard.portfolio.redeem', {
                  lang,
                }),
                callback_data: this.callbackBuilder(
                  'investmentWithdrawHandler',
                ),
              },
            ],
            [
              {
                text: this.i18n.t('bot.keyboard.goBack', { lang }),
                callback_data: this.callbackBuilder(this.accountHandler, {
                  editMessageId: msg.message_id,
                }),
              },
            ],
          ],
        },
      });
    } catch (err) {
      await reply(err.message);
    }
  }

  private async verificationHandler(msg: TelegramBot.Message) {
    const { publicId, chatId, userId, lang, reply } = await this.getContext(
      msg,
    );

    try {
      const state = await this.redisService.client.hget('bot:state', chatId);
      if (state === BotState.AwaitingVerificationCode) {
        const [verificationCode] = await this.redisService.client.hmget(
          `bot:user:${publicId}:verification-code`,
          'verificationCode',
        );
        if (!verificationCode) {
          throw new Error('Verification code not found');
        }
        if (verificationCode !== msg.text) {
          await reply('bot.account.verification.invalidCode');
          return;
        }

        await this.usersService.verifyProfile(userId);
        await reply('bot.account.verification.success');
        await this.redisService.client.del(
          `bot:user:${publicId}:verification-code`,
        );

        // Reset state
        await this.redisService.client.hdel('bot:state', chatId);
      } else {
        const user = await this.usersService.getById(userId);
        if (user.isVerified) {
          await reply('bot.account.verification.verified');
          return;
        }

        const captcha = svgCaptcha.create();
        const imgBuffer = await sharp(Buffer.from(captcha.data))
          .png()
          .toBuffer();
        const filePath = path.join(
          this.storageService.diskDestination,
          `${publicId}.png`,
        );

        await Promise.all([
          fs.writeFile(filePath, imgBuffer),
          this.redisService.client.hmset(
            `bot:user:${publicId}:verification-code`,
            { verificationCode: captcha.text },
          ),
        ]);
        await this.bot.sendPhoto(
          chatId,
          filePath,
          {
            caption: this.i18n.t('bot.account.action.verify', {
              lang,
            }),
          },
          { filename: `${publicId}.png`, contentType: 'image/png' },
        );
        await this.redisService.client.hset(
          'bot:state',
          chatId,
          BotState.AwaitingVerificationCode,
        );
      }
    } catch (err) {
      await reply(err.message);
    }
  }

  private async referralHandler(msg: TelegramBot.Message) {
    const { userId, lang, reply } = await this.getContext(msg);

    try {
      const referrer = await this.referralsService.getReferrerOf(userId);
      const [userMeta, referrerMeta, bonusWallet, totalBonusAmount] =
        await Promise.all([
          this.usersService.getMetaById(userId),
          referrer && this.usersService.getMetaById(referrer.id),
          this.walletsService.getByUserId(userId, WalletType.Bonus),
          this.referralsService.getTotalBonusAmount({
            userId,
          }),
        ]);
      const referredUsersCount =
        await this.referralsService.getReferredUsersCount(userMeta.uplineId);

      let msgText = '';
      if (!(await this.investmentsService.hasOf(userId))) {
        msgText = msgText.concat(
          this.i18n.t('bot.referral.unlock', { lang }),
          '\n\n',
        );
      }
      msgText = msgText.concat(
        this.i18n.t('bot.referral.info', {
          lang,
          args: {
            referralCode: userMeta.referralCode,
            referredUsersCount,
            bonusWalletAmount: bonusWallet.amount,
            totalBonusAmount,
          },
        }),
      );
      if (referrerMeta) {
        msgText = msgText.concat(
          '\n\n',
          this.i18n.t('bot.referral.code.info', {
            lang,
            args: { usedReferralCode: referrerMeta.referralCode },
          }),
        );
      }

      const replyKeyboard = [
        [
          {
            text: this.i18n.t('bot.keyboard.referral.withdraw', {
              lang,
            }),
            callback_data: this.callbackBuilder(
              this.referralBonusWithdrawHandler,
            ),
          },
        ],
        [
          {
            text: this.i18n.t('bot.keyboard.goBack', { lang }),
            callback_data: this.callbackBuilder(this.accountHandler, {
              editMessageId: msg.message_id,
            }),
          },
        ],
      ];
      if (!referrer) {
        replyKeyboard.unshift([
          {
            text: this.i18n.t('bot.keyboard.referral.unlock', {
              lang,
            }),
            callback_data: this.callbackBuilder(this.setReferralCodeHandler),
          },
        ]);
      }

      await reply(msgText, {
        isText: true,
        editMessageId: msg.message_id,
        reply_markup: {
          inline_keyboard: replyKeyboard,
        },
      });
    } catch (err) {
      await reply(err.message);
    }
  }

  private async setReferralCodeHandler(msg: TelegramBot.Message) {
    const { userId, chatId, reply } = await this.getContext(msg);

    try {
      const state = await this.redisService.client.hget('bot:state', chatId);
      if (state === BotState.AwaitingReferralCode) {
        const code = msg.text || '';
        const referrer = await this.referralsService.getReferrerByCode(code);
        if (!referrer) {
          await reply('bot.referral.invalidCode');
          return;
        }

        await this.usersService.setReferrerCode(userId, code);
        await reply('bot.referral.code.success');

        // Reset state
        await this.redisService.client.hdel('bot:state', chatId);
      } else {
        await this.redisService.client.hset(
          'bot:state',
          chatId,
          BotState.AwaitingReferralCode,
        );
        await reply('bot.referral.action.enterCode');
      }
    } catch (err) {
      await reply(err.message);
    }
  }

  private async referralBonusWithdrawHandler(msg: TelegramBot.Message) {
    const { chatId, userId, reply } = await this.getContext(msg);

    try {
      const bonusWallet = await this.walletsService.getByUserId(
        userId,
        WalletType.Bonus,
      );

      const state = await this.redisService.client.hget('bot:state', chatId);
      if (state === BotState.AwaitingWithdrawReferralBonusAmount) {
        // Validate input
        if (!/^[0-9]+$/.test(msg.text || '')) {
          await reply('bot.referral.invalidAmount');
          return;
        }

        // Validate amount
        const amount = new Prisma.Decimal(msg.text || 0).toDP(2);
        if (amount.lessThanOrEqualTo(0)) {
          await reply('bot.referral.minAmountError');
          return;
        }
        if (amount.greaterThan(bonusWallet.amount)) {
          await reply('bot.referral.maxAmountError', {
            args: { amount: bonusWallet.amount },
          });
          return;
        }

        await this.prisma.$transaction(async (tx) => {
          return await this.walletsService.transferAmountBonusToMain(
            userId,
            amount,
            {
              tx,
              mainContext: WalletTransactionContext.BonusWithdrawl,
              bonusContext: WalletTransactionContext.Withdrawal,
            },
          );
        });
        await reply('bot.referral.withdraw.success');

        // Reset state
        await this.redisService.client.hdel('bot:state', chatId);
      } else {
        await this.redisService.client.hset(
          'bot:state',
          chatId,
          BotState.AwaitingWithdrawReferralBonusAmount,
        );
        await reply('bot.referral.action.withdraw', {
          args: { bonusWalletAmount: bonusWallet.amount },
        });
      }
    } catch (err) {
      await reply(err.message);
    }
  }

  @TransformArgs()
  private async investmentWithdrawHandler(
    msg: TelegramBot.Message,
    @ArgType(InvestmentWithdrawArgsDto) args?: InvestmentWithdrawArgsDto,
  ) {
    const { publicId, userId, lang, reply } = await this.getContext(msg);
    if (!args) args = new InvestmentWithdrawArgsDto();
    if (!args.phase) {
      args.phase = InvestmentWithdrawPhase.Initial;
    }

    try {
      if (args.phase > InvestmentWithdrawPhase.TakeAcknowledgement) {
        const [portfolioId] = await this.redisService.client.hmget(
          `bot:user:${publicId}:redeem-investment`,
          'portfolioId',
        );
        if (!portfolioId) {
          throw new Error('Portfolio ID not found');
        }
        args.portfolioId = Number(portfolioId);
      }

      await this.callPhaseHandler(args.phase, [
        // Phase Initial
        async () => {
          const investments = await this.investmentsService.getAll({
            filters: { userId, status: InvestmentStatus.Active },
          });

          await reply('bot.portfolio.action.redeem', {
            editMessageId: msg.message_id,
            reply_markup: {
              inline_keyboard: [
                ...investments.map((investment) => {
                  let text = this.i18n.t('bot.keyboard.portfolio.portfolio', {
                    lang,
                  });
                  text = text.concat(
                    ' ',
                    investment.portfolioId.toString(),
                    ' / ',
                    'Current Value:',
                    ' ',
                    investment.amount.toString(),
                  );
                  return [
                    {
                      text,
                      callback_data: this.callbackBuilder(
                        'investmentWithdrawHandler',
                        {
                          phase: InvestmentWithdrawPhase.TakeAcknowledgement,
                          portfolioId: investment.portfolioId,
                        },
                      ),
                    },
                  ];
                }),
                [
                  {
                    text: this.i18n.t('bot.keyboard.goBack', { lang }),
                    callback_data: this.callbackBuilder(this.portfolioHandler, {
                      editMessageId: msg.message_id,
                    }),
                  },
                ],
              ],
            },
          });
        },
        // Phase TakeAcknowledgement
        async () => {
          const investment = await this.investmentsService.getByPortfolioId(
            args?.portfolioId as number,
            userId,
          );
          await this.redisService.client.hmset(
            `bot:user:${publicId}:redeem-investment`,
            { portfolioId: args?.portfolioId },
          );
          await reply('bot.portfolio.action.acknowledged', {
            editMessageId: msg.message_id,
            args: {
              portfolioId: investment.portfolioId,
              investmentAmount: investment.amount,
            },
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: this.i18n.t('bot.keyboard.acknowledged.0', {
                      lang,
                    }),
                    callback_data: this.callbackBuilder(
                      'investmentWithdrawHandler',
                      {
                        phase: InvestmentWithdrawPhase.Proceed,
                        acknowledged: true,
                      },
                    ),
                  },
                  {
                    text: this.i18n.t('bot.keyboard.acknowledged.1', {
                      lang,
                    }),
                    callback_data: this.callbackBuilder(
                      'investmentWithdrawHandler',
                      {
                        phase: InvestmentWithdrawPhase.Proceed,
                        acknowledged: false,
                      },
                    ),
                  },
                ],
              ],
            },
          });
        },
        // Phase Proceed
        async () => {
          if (args?.acknowledged) {
            const investment = await this.investmentsService.getByPortfolioId(
              args?.portfolioId as number,
              userId,
            );
            await this.investmentsService.redeem(userId, investment.id);
            await reply('bot.portfolio.action.confirmed', {
              editMessageId: msg.message_id,
            });
          } else {
            await reply('bot.portfolio.action.denied', {
              editMessageId: msg.message_id,
            });
          }
        },
      ]);
    } catch (err) {
      await reply(err.message);
    }
  }

  async notifyOnPaymentSuccess(userId: string, chatId: string): Promise<void> {
    const user = await this.usersService.getById(userId);
    if (!user) throw new Error('User not found');

    const { reply } = await this.createContext({
      publicId: user.publicId,
      chatId,
    });
    await reply('bot.payment.success');
  }
}
