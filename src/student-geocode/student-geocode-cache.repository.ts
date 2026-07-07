import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';

export interface StudentHomeGeocodeCacheRow extends Record<string, unknown> {
  student_uuid: string;
  lat: number;
  lng: number;
  source_address_text: string;
  geocoded_at: Date | string;
}

@Injectable()
export class StudentGeocodeCacheRepository {
  constructor(private readonly dataSource: DataSource) {}

  async find(studentUuid: string): Promise<StudentHomeGeocodeCacheRow | null> {
    const result = await queryDataSource<StudentHomeGeocodeCacheRow>(
      this.dataSource,
      `SELECT student_uuid, lat, lng, source_address_text, geocoded_at
       FROM student_home_geocode_cache
       WHERE student_uuid = $1`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async upsert(
    studentUuid: string,
    lat: number,
    lng: number,
    sourceAddressText: string,
  ): Promise<void> {
    await queryDataSource(
      this.dataSource,
      `INSERT INTO student_home_geocode_cache (student_uuid, lat, lng, source_address_text, geocoded_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (student_uuid)
       DO UPDATE SET lat = $2, lng = $3, source_address_text = $4, geocoded_at = now()`,
      [studentUuid, lat, lng, sourceAddressText],
    );
  }
}
