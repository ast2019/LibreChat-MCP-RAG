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
};

export type TAdminBillingPack = {
  id: string;
  label: string;
  credits: number;
  description?: string;
};

export type TAdminBillingPacksResponse = { enabled: boolean; packs: TAdminBillingPack[] };

export type TAdminBillingGrantRequest =
  | { userId: string; packId: string }
  | { userId: string; credits: number };

export type TAdminBillingGrantResponse = {
  balance: number;
  credits: number;
  packAllotment: number;
  pack: { id: string; label: string } | null;
};
