import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PaginatedDto } from '@Common';

export class GetUsersRequestDto extends PaginatedDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(Prisma.SortOrder)
  sortOrder?: Prisma.SortOrder;
}
