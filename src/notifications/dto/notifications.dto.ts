import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { NOTIFICATION_READ_STATUSES, type NotificationReadStatus } from '../notifications.types';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_READ_STATUSES)
  status?: NotificationReadStatus;
}
