import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export class OverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  days?: number;
}
