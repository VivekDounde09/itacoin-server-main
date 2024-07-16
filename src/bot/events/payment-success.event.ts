import { BaseEvent } from '@Common';

export class PaymentSuccessEvent extends BaseEvent {
  constructor(
    readonly payerId: string,
    readonly chatId: string,
  ) {
    super('bot.paymentSuccess');
  }
}
