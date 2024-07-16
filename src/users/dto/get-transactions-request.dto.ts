import { IsDate, IsOptional, IsUUID, IsEnum } from 'class-validator';
import { WalletType } from '@prisma/client';
import { PaginatedDto } from '@Common';

export class GetTransactionsRequestDto extends PaginatedDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(WalletType)
  walletType?: WalletType;

  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @IsOptional()
  @IsDate()
  toDate?: Date;
}
