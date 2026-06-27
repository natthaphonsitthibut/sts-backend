import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { geoConfig } from '../config/geo.config';

interface GoogleGeocodeLocation {
  lat: number;
  lng: number;
}

interface GoogleGeocodeResult {
  formatted_address?: string;
  geometry?: {
    location?: GoogleGeocodeLocation;
    location_type?: string;
  };
  place_id?: string;
}

interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string | null;
  locationType: string | null;
  placeId: string | null;
  provider: 'google';
}

@Injectable()
export class GeoService {
  constructor(
    @Inject(geoConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof geoConfig>,
  ) {}

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))
    );
  }

  async geocodeAddress(address: string, language = 'th'): Promise<GeocodeResult | null> {
    const apiKey = this.runtimeConfig.googleMapsServerKey;
    if (!apiKey) {
      throw new ServiceUnavailableException('Geocoding service is not configured');
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('language', language || 'th');
    url.searchParams.set('region', 'th');
    url.searchParams.set('key', apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.runtimeConfig.googleMapsGeocodeTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new ServiceUnavailableException('Geocoding service timed out');
      }
      throw new ServiceUnavailableException('Geocoding service is unavailable');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Geocoding service is unavailable');
    }

    let body: GoogleGeocodeResponse;
    try {
      body = (await response.json()) as GoogleGeocodeResponse;
    } catch {
      throw new ServiceUnavailableException('Geocoding service is unavailable');
    }

    if (body.status === 'ZERO_RESULTS') {
      return null;
    }
    if (body.status !== 'OK') {
      throw new ServiceUnavailableException('Geocoding service is unavailable');
    }

    const firstResult = body.results?.[0];
    const location = firstResult?.geometry?.location;
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      return null;
    }

    return {
      lat: location.lat,
      lng: location.lng,
      formattedAddress: firstResult.formatted_address ?? null,
      locationType: firstResult.geometry?.location_type ?? null,
      placeId: firstResult.place_id ?? null,
      provider: 'google',
    };
  }
}
