import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
import { UpsertMasterDataItemDto } from './dto/master-data.dto';
import { MasterDataService } from './master-data.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('settings')
@Controller('api/master-data')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get(':table')
  getAll(@Param('table') table: string) {
    return this.masterDataService.getAll(table);
  }

  @Get(':table/:id')
  getById(@Param('table') table: string, @Param('id', ParseIntPipe) id: number) {
    return this.masterDataService.getById(table, id);
  }

  @Post(':table')
  create(@Param('table') table: string, @Body() body: UpsertMasterDataItemDto) {
    return this.masterDataService.create(table, body);
  }

  @Put(':table/:id')
  update(
    @Param('table') table: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpsertMasterDataItemDto,
  ) {
    return this.masterDataService.update(table, id, body);
  }

  @Delete(':table/:id')
  remove(@Param('table') table: string, @Param('id', ParseIntPipe) id: number) {
    return this.masterDataService.remove(table, id);
  }
}
