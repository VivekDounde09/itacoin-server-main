import { Controller } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BaseController } from '@Common';
import { BotService } from './bot.service';
import { PaymentSuccessEvent } from './events';

@Controller()
export class BotController extends BaseController {
  constructor(private readonly botService: BotService) {
    super();
  }

  @OnEvent('bot.paymentSuccess', { async: true })
  async handlePaymentSuccessEvent(payload: PaymentSuccessEvent) {
    await this.botService.notifyOnPaymentSuccess(
      payload.payerId,
      payload.chatId,
    );
  }
}
