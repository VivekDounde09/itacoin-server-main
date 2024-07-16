import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';
import { InvestmentsService } from './investments.service';
import {
  CreateInvestmentGrowthRequestDto,
  GetInvestmentGrowthsRequestDto,
  GetInvestmentsRequestDto,
  GetStatsRequestDto,
} from './dto';

@Controller()
export class InvestmentsController extends BaseController {
  constructor(private readonly investmentsService: InvestmentsService) {
    super();
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('investment-baskets')
  async getAllBaskets() {
    return await this.investmentsService.getAllBaskets();
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('investments')
  async getInvestments(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetInvestmentsRequestDto,
  ) {
    return await this.investmentsService.getAll({
      filters: {
        investmentId: query.investmentId,
        portfolioId: query.portfolioId,
        fromDate: query.fromDate,
        toDate: query.toDate,
        tier: query.tier,
      },
      skip: query.skip,
      take: query.take,
    });
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('investment-stats')
  async getInvestmentStats(@Query() options: GetStatsRequestDto) {
    return await this.investmentsService.getStats({
      fromDate: options.fromDate,
      toDate: options.toDate,
    });
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('investments/growths')
  async createGrowth(@Body() data: CreateInvestmentGrowthRequestDto) {
    await this.investmentsService.createGrowth(data);
    return { status: 'success' };
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('investments/growths')
  async getGrowth(@Query() query: GetInvestmentGrowthsRequestDto) {
    return await this.investmentsService.getAllGrowths({
      filter: { year: query.year, month: query.month },
    });
  }
}
