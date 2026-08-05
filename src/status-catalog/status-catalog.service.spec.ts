import { StatusCatalogRepository } from './status-catalog.repository';
import { StatusCatalogService } from './status-catalog.service';

describe('StatusCatalogService', () => {
  it('groups explicit database status rows by domain', async () => {
    const repository = {
      findAll: jest.fn().mockResolvedValue([
        {
          domain_code: 'CASE_WORKFLOW',
          code: 'OPEN',
          internal_code: null,
          short_label_th: null,
          label_th: 'รอสร้างลิงก์',
          badge_variant: 'secondary',
          summary_tone: 'default',
          sort_order: 10,
        },
      ]),
    };
    const service = new StatusCatalogService(repository as unknown as StatusCatalogRepository);

    await expect(service.getCatalogs()).resolves.toEqual({
      CASE_WORKFLOW: [
        {
          code: 'OPEN',
          internalCode: null,
          shortLabel: null,
          label: 'รอสร้างลิงก์',
          badgeVariant: 'secondary',
          summaryTone: 'default',
          sortOrder: 10,
        },
      ],
    });
  });
});
