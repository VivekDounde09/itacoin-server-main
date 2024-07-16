import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseController, UtilsService } from '@Common';
import { ReferralsService } from './referrals.service';

@Controller()
export class ReferralsController extends BaseController {
  constructor(
    private readonly referralsService: ReferralsService,
    private readonly utilsService: UtilsService,
  ) {
    super();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    await this.utilsService.rerunnable(
      async () => {
        await this.referralsService.unlockBonuses();
      },
      5,
      3000,
    );
  }
}
