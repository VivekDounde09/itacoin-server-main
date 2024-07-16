import path from 'path';
import ejs from 'ejs';
import nodemailer from 'nodemailer';
import { Queue } from 'bullmq';
import { SentMessageInfo } from 'nodemailer/lib/smtp-transport';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { mailConfigFactory, mailQueueConfigFactory } from '@Config';
import { UtilsService } from './utils.service';
import { MAIL_QUEUE } from '../common.constants';
import { MailTemplate } from '../types';

export type SendMessagePayload = {
  to: string;
  subject: string;
  mailBody: string | { template: MailTemplate; data?: Record<string, unknown> };
  attachments?: string[];
  replyTo?: string;
};

@Injectable()
export class MailService {
  transporter;

  constructor(
    @Inject(mailConfigFactory.KEY)
    private readonly config: ConfigType<typeof mailConfigFactory>,
    @Inject(mailQueueConfigFactory.KEY)
    private readonly queueConfig: ConfigType<typeof mailQueueConfigFactory>,
    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue<SendMessagePayload, SentMessageInfo>,
    private readonly utilsService: UtilsService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      auth: {
        user: this.config.auth.user,
        pass: this.config.auth.pass,
      },
    });
  }

  configureMessage = (
    to: string,
    subject: string,
    mailBody: string,
    attachments?: string[],
    replyTo?: string,
  ) => {
    const messageConfiguration: Record<string, unknown> = {
      from: this.config.sender,
      to,
      subject,
      html: mailBody,
      attachments: attachments ? attachments : [],
    };

    if (replyTo) {
      messageConfiguration.replyTo = replyTo;
    }

    return messageConfiguration;
  };

  async renderTemplate(template: MailTemplate, data?: Record<string, unknown>) {
    return await ejs.renderFile(
      path.resolve('templates', 'mail', `${template}.ejs`),
      data,
    );
  }

  async send(mailPayload: SendMessagePayload): Promise<void> {
    await this.mailQueue.add('send', mailPayload, {
      removeOnComplete: {
        age: this.utilsService.msToSec(this.queueConfig.removeCompletedAfter),
      },
      removeOnFail: {
        age: this.utilsService.msToSec(this.queueConfig.removeFailedAfter),
      },
    });
  }
}
