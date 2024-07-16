import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class Basket {
  @IsUUID()
  id: string;

  @IsNumber()
  growth: number;
}

export class CreateInvestmentGrowthRequestDto {
  @IsNumber()
  @Min(1)
  @Max(12)
  month: number;

  @IsNumber()
  year: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Basket)
  baskets: Basket[];
}
