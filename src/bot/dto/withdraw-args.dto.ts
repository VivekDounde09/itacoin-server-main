import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export enum WithdrawPhase {
  TakeAmountInput,
  ValidateAndTakeWalletInput,
  ValidateAndTakeAcknowledgement,
  Proceed,
}

export class WithdrawArgsDto {
  @IsOptional()
  @IsEnum(WithdrawPhase)
  phase?: WithdrawPhase;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Transform((params) =>
    params.obj.acknowledged === 'false' || params.obj.acknowledged === '0'
      ? false
      : params.value,
  )
  @IsBoolean()
  acknowledged?: boolean;
}
