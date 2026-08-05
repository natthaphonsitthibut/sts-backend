import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { StudentGeocodeCacheRepository } from './student-geocode-cache.repository';
import { StudentGeocodeCacheService } from './student-geocode-cache.service';

@Module({
  imports: [GeoModule],
  providers: [StudentGeocodeCacheRepository, StudentGeocodeCacheService],
  exports: [StudentGeocodeCacheService],
})
export class StudentGeocodeModule {}
