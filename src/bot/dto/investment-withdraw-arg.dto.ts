import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional } from 'class-validator';

export enum InvestmentWithdrawPhase {
  Initial,
  TakeAcknowledgement,
  Proceed,
}

export class InvestmentWithdrawArgsDto {
  @IsOptional()
  @IsEnum(InvestmentWithdrawPhase)
  phase?: InvestmentWithdrawPhase;

  @IsOptional()
  @IsNumber()
  portfolioId?: number;

  @IsOptional()
  @Transform((params) =>
    params.obj.acknowledged === 'false' || params.obj.acknowledged === '0'
      ? false
      : params.value,
  )
  @IsBoolean()
  acknowledged?: boolean;
}
