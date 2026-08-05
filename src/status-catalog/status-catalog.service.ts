import { Injectable } from '@nestjs/common';
import { StatusCatalogRepository } from './status-catalog.repository';

export interface StatusCatalogItem {
  code: string;
  internalCode: string | null;
  shortLabel: string | null;
  label: string;
  badgeVariant: string;
  summaryTone: string | null;
  sortOrder: number;
}

@Injectable()
export class StatusCatalogService {
  constructor(private readonly statusCatalogRepository: StatusCatalogRepository) {}

  async getCatalogs(): Promise<Record<string, StatusCatalogItem[]>> {
    const rows = await this.statusCatalogRepository.findAll();
    return rows.reduce<Record<string, StatusCatalogItem[]>>((catalogs, row) => {
      const items = catalogs[row.domain_code] ?? [];
      items.push({
        code: row.code,
        internalCode: row.internal_code,
        shortLabel: row.short_label_th,
        label: row.label_th,
        badgeVariant: row.badge_variant,
        summaryTone: row.summary_tone,
        sortOrder: Number(row.sort_order),
      });
      catalogs[row.domain_code] = items;
      return catalogs;
    }, {});
  }

  async getCatalog(domainCode: string): Promise<StatusCatalogItem[]> {
    const catalogs = await this.getCatalogs();
    return catalogs[domainCode] ?? [];
  }
}
