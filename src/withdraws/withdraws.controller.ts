import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  BaseController,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';
import { WithdrawsService } from './withdraws.service';
import { GetWithdrawsRequestsDto } from './dto';

@Controller()
export class WithdrawsController extends BaseController {
  constructor(private readonly withdrawsService: WithdrawsService) {
    super();
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('withdraws')
  async getAll(@Query() query: GetWithdrawsRequestsDto) {
    return await this.withdrawsService.getAll({
      filters: {
        fromDate: query.fromDate,
        toDate: query.toDate,
        status: query.status,
        address: query.address,
      },
      skip: query.skip,
      take: query.take,
    });
  }
}
