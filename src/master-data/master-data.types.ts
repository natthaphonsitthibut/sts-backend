export const CODED_MASTER_DATA_CATALOGS = [
  'absence-reason-categories',
  'absence-reasons',
  'disadvantage-types',
  'disability-types',
  'assistance-measures',
  'referral-agency-kinds',
  'non-follow-up-reasons',
] as const;

export type CodedMasterDataCatalog = (typeof CODED_MASTER_DATA_CATALOGS)[number];

export interface CodedMasterDataRow extends Record<string, unknown> {
  code: string;
  label_th: string;
  sort_order: number;
  is_active: boolean;
  category_code: string | null;
  category_label_th: string | null;
  source_onec_code: number | null;
  requires_detail: boolean | null;
  usage_count: number;
}

export interface ReferralAgencyRow extends Record<string, unknown> {
  id: number;
  agency_name: string;
  agency_kind_code: string;
  agency_kind_label_th: string;
  contact_phone: string | null;
  contact_email: string | null;
  website_url: string | null;
  is_active: boolean;
  usage_count: number;
}
