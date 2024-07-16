import { IsDate, IsOptional } from 'class-validator';

export class GetStatsRequestDto {
  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @IsOptional()
  @IsDate()
  toDate?: Date;
}
