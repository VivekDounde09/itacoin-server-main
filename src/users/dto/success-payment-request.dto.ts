import { IsInt, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class SuccessPaymentRequestDto {
  @IsString()
  @IsNotEmpty()
  uuid: string;

  @IsString()
  @IsNotEmpty()
  address_in: string;

  @IsString()
  @IsNotEmpty()
  address_out: string;

  @IsString()
  @IsNotEmpty()
  txid_in: string;

  @IsString()
  @IsNotEmpty()
  txid_out: string;

  @IsInt()
  @IsNotEmpty()
  confirmations: number;

  @IsNumber()
  @IsNotEmpty()
  value_coin: number;

  @IsString()
  @IsNotEmpty()
  value_coin_convert: string;

  @IsNumber()
  @IsNotEmpty()
  value_forwarded_coin: number;

  @IsString()
  @IsNotEmpty()
  value_forwarded_coin_convert: string;

  @IsNumber()
  @IsNotEmpty()
  fee_coin: number;

  @IsString()
  @IsNotEmpty()
  coin: string;

  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsInt()
  @IsNotEmpty()
  pending: number;
}
