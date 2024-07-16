import { Job } from 'bullmq';
import { SentMessageInfo } from 'nodemailer/lib/smtp-transport';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { mailQueueConfigFactory } from '@Config';
import { MAIL_QUEUE } from '../common.constants';
import { MailService, SendMessagePayload } from '../providers';
import { BaseProcessor } from '../base';

@Processor(MAIL_QUEUE)
export class MailProcessor extends BaseProcessor {
  constructor(
    @Inject(mailQueueConfigFactory.KEY)
    readonly config: ConfigType<typeof mailQueueConfigFactory>,
    private readonly mailService: MailService,
  ) {
    super(MailProcessor.name, config.concurrency);
  }

  async process(
    job: Job<SendMessagePayload, SentMessageInfo, string>,
  ): Promise<SentMessageInfo> {
    const { to, subject, attachments, replyTo } = job.data;
    let { mailBody } = job.data;

    if (typeof mailBody !== 'string') {
      mailBody = await this.mailService.renderTemplate(
        mailBody.template,
        mailBody.data,
      );
    }

    const mailOptions = this.mailService.configureMessage(
      to,
      subject,
      mailBody,
      attachments,
      replyTo,
    );
    return await this.mailService.transporter.sendMail(mailOptions);
  }
}
