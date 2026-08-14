import { Injectable, Logger } from '@nestjs/common';
import { GeoService } from '../geo/geo.service';
import { StudentGeocodeCacheRepository } from './student-geocode-cache.repository';

export interface ApproximateLocation {
  lat: number;
  lng: number;
}

/**
 * Approximate home coordinates for students without a confirmed home-visit
 * pin (`cases.student_lat/lng`) — geocoded once per student and cached in
 * `student_home_geocode_cache`, re-geocoded only when the registered address
 * text changes. Cuts repeat Google Geocoding API calls across every screen
 * that shows a student's approximate location (e.g. student detail)
 * instead of each one geocoding independently per view.
 */
@Injectable()
export class StudentGeocodeCacheService {
  private readonly logger = new Logger(StudentGeocodeCacheService.name);

  constructor(
    private readonly repository: StudentGeocodeCacheRepository,
    private readonly geoService: GeoService,
  ) {}

  async resolve(studentUuid: string, addressText: string): Promise<ApproximateLocation | null> {
    const trimmedAddress = addressText.trim();
    if (!trimmedAddress) {
      return null;
    }

    const cached = await this.repository.find(studentUuid);
    if (cached && cached.source_address_text === trimmedAddress) {
      return { lat: cached.lat, lng: cached.lng };
    }

    try {
      const geocoded = await this.geoService.geocodeAddress(trimmedAddress);
      if (!geocoded) {
        return null;
      }
      await this.repository.upsert(studentUuid, geocoded.lat, geocoded.lng, trimmedAddress);
      return { lat: geocoded.lat, lng: geocoded.lng };
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.warn(`Approximate geocode failed for ${studentUuid}: ${resolvedError.message}`);
      return null;
    }
  }
}
