export interface PlatformConfig {
  id: string;
  name: string;
  serviceName: string;
  hasSoldFilter: boolean;
  feeRate: number;
  locale: string;
  currency: string;
  currencyLabel: string;
  limits: { title: number; description: number; minPrice: number; maxPrice: number };
  defaultShipping: number;
  shippingMethods: readonly string[];
  shippingTable: readonly { name: string; cost: number; note: string }[];
  conditionLabels: readonly string[];
  titleFields: readonly string[];
  descriptionFields: readonly string[];
  formatDescription: (rows: { label: string; value: string }[], notes: string) => string;
  copyFields: readonly { key: "title" | "description" | "price"; label: string }[];
  formatCopy: (listing: { title: string; description: string; price: number }) => string;
  activeSearchUrl?: (keyword: string) => string;
  soldSearchUrl: (keyword: string) => string;
  searchHint: string;
  searchLabel: string;
  listingHint: string;
  openLabel: string;
  sellUrl: string;
}
