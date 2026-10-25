/** Admin billing page wire types (`/api/admin/balance/*`). */
export type TAdminBillingBalance = {
  tokenCredits: number;
  packId?: string;
  packLabel?: string;
  packAllotment?: number;
  packGrantedAt?: string;
};

export type TAdminBillingUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  createdAt?: string;
  balance: TAdminBillingBalance | null;
  /** Whole percent of the last pack used; null when nothing measures it */
  usedPercent: number | null;
};

export type TAdminBillingUsersParams = { search?: string; limit?: number; offset?: number };

export type TAdminBillingUsersResponse = {
  total: number;
  limit: number;
  offset: number;
  users: TAdminBillingUser[];
};

export type TAdminBillingSummary = {
  days: number;
  since: string;
  priceMultiplier: number;
  totalUsers: number;
  activeUsers: number;
  creditsGranted: number;
  creditsGrantedInWindow: number;
  packGrantsInWindow: number;
  creditsSpentInWindow: number;
  creditsOutstanding: number;
  estimatedProviderCredits: number;
  topModels: { model: string; credits: number }[];
  /** Rial per USD including the fee, to convert any USD figure; null when rial pricing is off or unavailable */
  rialPerUsd: number | null;
};

export type TAdminBillingPack = {
  id: string;
  label: string;
  credits: number;
  description?: string;
  /** The pack's value in US dollars of marked-up usage */
  priceUsd: number;
  /** What a user pays in rial; null when rial pricing is off or no rate is available */
  priceRial: number | null;
};

/** The USD to rial rate the admin prices were computed with. */
export type TAdminBillingRial = {
  enabled: boolean;
  /** Market rial per USD before the fee */
  marketRate: number;
  feePercent: number;
  /** Rial per USD including the fee */
  rate: number;
  source: 'tgju' | 'fixed';
  /** ISO time the market rate was published or fetched */
  updatedAt: string;
  /** True when the latest refresh failed and an older rate is being served */
  stale: boolean;
};

export type TAdminBillingPacksResponse = {
  enabled: boolean;
  packs: TAdminBillingPack[];
  rial: TAdminBillingRial | null;
};

/** User-facing pack wire types (`/api/balance/packs`): rial prices only. */
export type TUserBalancePack = {
  id: string;
  label: string;
  description?: string;
  priceRial: number | null;
};

export type TUserBalancePacksResponse = {
  enabled: boolean;
  packs: TUserBalancePack[];
  purchaseUrl?: string;
};

export type TAdminBillingGrantRequest =
  | { userId: string; packId: string }
  | { userId: string; credits: number };

export type TAdminBillingGrantResponse = {
  balance: number;
  credits: number;
  packAllotment: number;
  pack: { id: string; label: string } | null;
};
