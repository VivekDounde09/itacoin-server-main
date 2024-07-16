import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional } from 'class-validator';

export enum InvestmentPhase {
  Initial,
  TakeAmountInput,
  ValidateAndTakeAcknowledgement,
  Proceed,
}

export class InvestmentArgsDto {
  @IsOptional()
  @IsEnum(InvestmentPhase)
  phase?: InvestmentPhase;

  @IsOptional()
  @IsNumber()
  tier?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @Transform((params) =>
    params.obj.acknowledged === 'false' || params.obj.acknowledged === '0'
      ? false
      : params.value,
  )
  @IsBoolean()
  acknowledged?: boolean;
}
