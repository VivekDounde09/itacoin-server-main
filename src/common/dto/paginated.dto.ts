import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class PaginatedDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Max(1000)
  take?: number;
}
