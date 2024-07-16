import { Controller } from '@nestjs/common';
import { BaseController } from '@Common';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController extends BaseController {
  constructor(private readonly paymentsService: PaymentsService) {
    super();
  }
}
