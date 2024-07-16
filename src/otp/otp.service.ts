import dayjs from 'dayjs';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Otp, OtpTransport, Prisma } from '@prisma/client';
import { appConfigFactory, otpConfigFactory } from '@Config';
import { MailService, MailTemplate, UtilsService } from '@Common';
import { PrismaService } from '../prisma';

export type SendCodeResponse = {
  sentAt: Date;
  timeout: number;
  attempt: number;
  maxAttempt: number;
};

export type VerifyCodeResponse = {
  status: boolean;
  retries: number;
  maxRetries: number;
};

@Injectable()
export class OtpService {
  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(otpConfigFactory.KEY)
    private readonly config: ConfigType<typeof otpConfigFactory>,
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly mailService: MailService,
  ) {}

  private blockError(target: string, blockTimeout: number): Error {
    return new Error(
      `${target} temporary blocked for ${this.utilsService.msToHuman(
        blockTimeout,
        { maxUnit: 'hour' },
      )}, due to max wrong attempts or failed retries`,
    );
  }

  private generateCode(length: number): string {
    if (!this.utilsService.isProductionApp()) {
      return this.config.default;
    }

    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars[Math.floor(Math.random() * 10)];
    }
    return code;
  }

  private isBlockTimeout(lastSentAt: Date, blockTimeout: number): boolean {
    return dayjs().isAfter(dayjs(lastSentAt).add(blockTimeout, 'ms'));
  }

  private isTimeout(lastSentAt: Date, timeout: number): boolean {
    return dayjs().isAfter(dayjs(lastSentAt).add(timeout, 'ms'));
  }

  private async find(
    target: string,
    transport: OtpTransport,
  ): Promise<Otp | null> {
    return await this.prisma.otp.findUnique({
      where: {
        transport_target: {
          transport,
          target: target.toLowerCase(), // Can be email address as well
        },
      },
    });
  }

  private async update(
    target: string,
    transport: OtpTransport,
    data: Prisma.OtpUpdateInput,
  ): Promise<Otp> {
    return await this.prisma.otp.update({
      data,
      where: {
        transport_target: {
          transport,
          target: target.toLowerCase(),
        },
      },
    });
  }

  // TODO: Configure sms gateway to send an sms
  private async sendSMS(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    target: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    data: { code: string; timeout: number },
  ): Promise<void> {
    if (!this.utilsService.isProductionApp()) return;
  }

  private async sendEmail(
    target: string,
    data: { code: string; timeout: number },
  ): Promise<void> {
    if (!this.utilsService.isProductionApp()) return;

    await this.mailService.send({
      to: target,
      subject: 'Verification Code',
      mailBody: {
        template: MailTemplate.VerificationCode,
        data: {
          code: data.code,
          expirationTime: this.utilsService.msToHuman(data.timeout),
        },
      },
    });
  }

  private async sendCodeOnTarget(
    target: string,
    transport: OtpTransport,
    code: string,
    timeout: number,
  ): Promise<void> {
    if (transport === OtpTransport.Mobile) {
      return await this.sendSMS(target, { code, timeout });
    }

    if (transport === OtpTransport.Email) {
      return await this.sendEmail(target, { code, timeout });
    }

    throw new Error(
      `Unknown transport ${transport} to send verification code on ${target}`,
    );
  }

  async send(
    target: string,
    transport: OtpTransport,
    overrides?: {
      length?: number;
      maxAttempt?: number;
      timeout?: number;
      blockTimeout?: number;
    },
  ): Promise<SendCodeResponse> {
    const config = {
      ...this.config,
      length: overrides?.length || this.config.length,
      maxAttempt: overrides?.maxAttempt || this.config.maxAttempt,
      timeout: overrides?.timeout || this.config.timeout,
      blockTimeout: overrides?.blockTimeout || this.config.blockTimeout,
    };

    let otp = await this.find(target, transport);

    if (!otp) {
      const code =
        transport === OtpTransport.Mobile
          ? this.config.default
          : this.generateCode(config.length);
      otp = await this.prisma.otp.create({
        data: {
          code,
          lastSentAt: new Date(),
          target: target.toLowerCase(),
          transport: transport,
        },
      });
      await this.sendCodeOnTarget(target, transport, code, config.timeout);
    } else {
      const isBlockTimeout = this.isBlockTimeout(
        otp.lastSentAt,
        config.blockTimeout,
      );

      if (otp.blocked && !isBlockTimeout) {
        throw this.blockError(target, config.blockTimeout);
      }

      if (
        !this.isTimeout(otp.lastSentAt, config.timeout) &&
        !otp.lastCodeVerified
      ) {
        throw new Error(
          `Resend verification code on ${target} not allowed with in ${this.utilsService.msToHuman(
            config.timeout,
          )}`,
        );
      }

      if (isBlockTimeout || otp.lastCodeVerified) {
        otp.attempt = 0;
      }

      if (config.maxAttempt - otp.attempt === 0) {
        await this.update(target, transport, { blocked: true });
        throw this.blockError(target, config.blockTimeout);
      }

      const code = this.generateCode(config.length);
      otp = await this.update(target, transport, {
        code,
        lastSentAt: new Date(),
        attempt: otp.attempt + 1,
        retries: 0,
        blocked: false,
        lastCodeVerified: false,
      });
      await this.sendCodeOnTarget(target, transport, code, config.timeout);
    }

    return {
      sentAt: otp.lastSentAt,
      timeout: config.timeout,
      attempt: otp.attempt,
      maxAttempt: config.maxAttempt,
    };
  }

  async verify(
    code: string,
    target: string,
    transport: OtpTransport,
    overrides?: {
      maxRetries?: number;
      timeout?: number;
      blockTimeout?: number;
    },
  ): Promise<VerifyCodeResponse> {
    const config = {
      ...this.config,
      maxRetries: overrides?.maxRetries || this.config.maxRetries,
      timeout: overrides?.timeout || this.config.timeout,
      blockTimeout: overrides?.blockTimeout || this.config.blockTimeout,
    };

    let otp = await this.find(target, transport);

    if (!otp) {
      throw new Error(`No verification code sent on ${target}`);
    }

    if (otp.blocked) {
      throw this.blockError(target, config.blockTimeout);
    }

    if (this.isTimeout(otp.lastSentAt, config.timeout)) {
      throw new Error(`Verification code for ${target} expired, Try resend`);
    }

    const isMatched = code === otp.code;

    if (!isMatched) {
      otp.retries += 1;

      otp = await this.update(target, transport, {
        retries: otp.retries,
        blocked: config.maxRetries - otp.retries === 0,
      });
    } else {
      otp = await this.update(target, transport, {
        lastCodeVerified: true,
      });
    }

    return {
      status: isMatched,
      retries: otp.retries,
      maxRetries: config.maxRetries,
    };
  }
}
