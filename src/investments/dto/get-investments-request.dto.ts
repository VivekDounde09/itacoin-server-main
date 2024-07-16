import { IsDate, IsOptional, IsUUID, IsNumber } from 'class-validator';
import { PaginatedDto } from '@Common';

export class GetInvestmentsRequestDto extends PaginatedDto {
  @IsOptional()
  @IsUUID()
  investmentId?: string;

  @IsOptional()
  @IsNumber()
  portfolioId?: number;

  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @IsOptional()
  @IsDate()
  toDate?: Date;

  @IsOptional()
  @IsNumber()
  tier?: number;
}
