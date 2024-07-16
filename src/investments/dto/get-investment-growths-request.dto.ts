import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class GetInvestmentGrowthsRequestDto {
  @IsOptional()
  @IsNumber()
  year?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;
}
