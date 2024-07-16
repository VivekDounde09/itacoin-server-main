// import crypto from 'crypto';
// import { Buffer } from 'buffer';
// import { firstValueFrom } from 'rxjs';
import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  // UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Request } from 'express';
import { UserStatus } from '@prisma/client';
import {
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';
import { UsersService } from './users.service';
import {
  GetTransactionsRequestDto,
  GetUsersRequestDto,
  SuccessPaymentRequestDto,
} from './dto';

@Controller('users')
export class UsersController extends BaseController {
  constructor(
    private readonly usersService: UsersService,
    private readonly httpService: HttpService,
  ) {
    super();
  }

  @Get(':userId/payments/success')
  async paymentSuccess(
    @Req() req: Request,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: SuccessPaymentRequestDto,
  ) {
    // Validate request
    // const response = await firstValueFrom(
    //   this.httpService.get<{ status: string; pubkey: string }>(
    //     'https://api.cryptapi.io/pubkey',
    //   ),
    // );
    // const signature = Buffer.from(
    //   (req.headers['x-ca-signature'] as string) || '',
    //   'base64',
    // );
    // const verifier = crypto.createVerify('RSA-SHA256');
    // verifier.update(req.protocol + '://' + req.get('host') + req.originalUrl);
    // if (!verifier.verify(response.data.pubkey, signature)) {
    //   throw new UnauthorizedException();
    // }

    // Parse the JSON fields
    query.value_coin_convert = JSON.parse(query.value_coin_convert);
    query.value_forwarded_coin_convert = JSON.parse(
      query.value_forwarded_coin_convert,
    );

    await this.usersService.addBalance({
      paymentId: query.uuid,
      userId,
      amount: query.value_coin,
      fees: query.fee_coin,
      receivedAmount: query.value_forwarded_coin,
      amountInUsd: (query.value_coin_convert as any).USD,
      receivedAmountInUsd: (query.value_forwarded_coin_convert as any).USD,
      priceInUsd: query.price,
      txidIn: query.txid_in,
      txidOut: query.txid_out,
    });

    return '*ok*';
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('transactions')
  async getTransactions(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetTransactionsRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.usersService.getTransactions(ctx.user.type, {
      filters: {
        userId: query.userId,
        walletType: query.walletType,
        fromDate: query.fromDate,
        toDate: query.toDate,
      },
      skip: query.skip,
      take: query.take,
    });
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  async getUsers(@Query() query: GetUsersRequestDto) {
    return await this.usersService.getAll({
      search: query.search,
      skip: query.skip,
      take: query.take,
      sortOrder: query.sortOrder,
    });
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':userId')
  async getUserProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return await this.usersService.getProfile(userId);
  }

  @Roles(UserType.Admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':userId/:status')
  async setUserAccountStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('status', new ParseEnumPipe(UserStatus)) status: UserStatus,
  ) {
    await this.usersService.setAccountStatus(userId, status);
    return { status: 'success' };
  }
}
