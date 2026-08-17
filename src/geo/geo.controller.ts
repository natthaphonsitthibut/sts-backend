import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
import { ThrottleGeocode } from '../config/throttle.decorators';
import { GeocodeQueryDto } from './dto/geocode.dto';
import { GeoService } from './geo.service';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @ThrottleGeocode()
  @RequirePermission('dashboard')
  @Get('geocode')
  async geocode(@Query() query: GeocodeQueryDto) {
    return await this.geoService.geocodeAddress(query.address, query.language);
  }

  @ThrottleGeocode()
  @Get('profile-geocode')
  async geocodeProfileAddress(@Query() query: GeocodeQueryDto) {
    return await this.geoService.geocodeAddress(query.address, query.language);
  }
}
