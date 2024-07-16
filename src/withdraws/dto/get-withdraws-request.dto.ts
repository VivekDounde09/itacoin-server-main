import { IsDate, IsEnum, IsEthereumAddress, IsOptional } from 'class-validator';
import { WithdrawStatus } from '@prisma/client';
import { PaginatedDto } from '@Common';

export class GetWithdrawsRequestsDto extends PaginatedDto {
  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @IsOptional()
  @IsDate()
  toDate?: Date;

  @IsOptional()
  @IsEnum(WithdrawStatus)
  status?: WithdrawStatus;

  @IsOptional()
  @IsEthereumAddress()
  address?: string;
}
