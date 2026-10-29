import type { TUserModelAccess } from '../permissions';

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
  /** E.164 mobile number; empty when the account has none. Older servers omit it. */
  phone?: string;
  role: string;
  createdAt?: string;
  /** Local/private model override; an absent key follows the role. Older servers omit it. */
  modelAccess?: TUserModelAccess;
  /** Programming API override; absent follows the role. Older servers omit it. */
  apiAccess?: boolean;
  /** Media generation override; absent follows the deployment rule. Older servers omit it. */
  mediaAccess?: boolean;
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
  /** Part of the spend with no provider cost (on-server OCR); excluded from the provider cost */
  creditsSpentLocalInWindow?: number;
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

export type TAdminBillingPacksResponse = {
  enabled: boolean;
  packs: TAdminBillingPack[];
  /** Credits every new account gets on sign-up (the welcome gift); 0 when there is none */
  startBalance?: number;
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

/** `POST /api/admin/balance/users`: an email account needs a password, a phone-only one does not. */
export type TAdminCreateUserRequest = {
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  role: 'USER' | 'ADMIN';
};

export type TAdminCreateUserResponse = {
  user: { id: string; name: string; email: string; phone: string; role: string };
};

/** `POST|DELETE /api/admin/roles/ADMIN/members`: make a user an admin, or a regular user again. */
export type TAdminSetUserRoleRequest = { userId: string; admin: boolean };

/** `PATCH /api/admin/users/:id/model-access` */
export type TAdminModelAccessRequest = {
  userId: string;
  /** `true`/`false` sets the override, `null` follows the role again; omitted keys are kept */
  local?: boolean | null;
  private?: boolean | null;
};

export type TAdminModelAccessResponse = { id: string; modelAccess: TUserModelAccess };

/** `PATCH /api/admin/users/:id/api-access`: `true`/`false` sets the override, `null` follows the role */
export type TAdminApiAccessRequest = { userId: string; apiAccess: boolean | null };

export type TAdminApiAccessResponse = { id: string; apiAccess: boolean | null };

/** `PATCH /api/admin/users/:id/media-access`: `true`/`false` sets the override, `null` clears it */
export type TAdminMediaAccessRequest = { userId: string; mediaAccess: boolean | null };

export type TAdminMediaAccessResponse = { id: string; mediaAccess: boolean | null };

/** `GET /api/admin/balance/usage?userId=&days=`: where one user's credits went. */
export interface TAdminBillingUserUsage {
  user: { id: string; email?: string };
  days: number;
  since: string;
  /** Positive credits spent in the window */
  totalCredits: number;
  /** Ledger context (`message`, `memory`, `title`, `ocr`, `tts`…), largest first */
  byContext: Array<{ context: string; credits: number; count: number }>;
  /** Model, largest first */
  byModel: Array<{ model: string; credits: number }>;
}
