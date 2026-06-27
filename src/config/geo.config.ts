import { registerAs } from '@nestjs/config';

export interface GeoConfig {
  googleMapsServerKey: string;
  googleMapsGeocodeTimeoutMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGeoConfigFromEnv(): GeoConfig {
  return {
    googleMapsGeocodeTimeoutMs: parsePositiveInt(process.env.GOOGLE_MAPS_GEOCODE_TIMEOUT_MS, 5000),
    googleMapsServerKey: process.env.GOOGLE_MAPS_SERVER_KEY?.trim() || '',
  };
}

export const geoConfig = registerAs('geo', () => getGeoConfigFromEnv());
