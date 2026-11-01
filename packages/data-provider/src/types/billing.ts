import type { TAccessClass, TEffectiveAccessMap, TPackGrants } from '../access';
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
  /** Agent browser override; absent follows the pack. Older servers omit it. */
  browserAccess?: boolean;
  /** The pack copied onto the user on its last grant; its `grants` decide local, private and API */
  packId?: string;
  balance: TAdminBillingBalance | null;
  /** Whole percent of the last pack used; null when nothing measures it */
  usedPercent: number | null;
  /** What each access class resolves to now and who decided it. Older servers omit it. */
  effective?: TEffectiveAccessMap;
};

export type TAdminBillingUserRoleFilter = 'USER' | 'ADMIN';
export type TAdminBillingBalanceFilter = 'positive' | 'empty';
export type TAdminBillingAccessFilter = 'custom' | 'default';
export type TAdminBillingUserSort = 'newest' | 'oldest' | 'name';

export type TAdminBillingUsersParams = {
  search?: string;
  role?: TAdminBillingUserRoleFilter;
  /** `has`, `none`, or a configured pack ID. */
  pack?: string;
  balance?: TAdminBillingBalanceFilter;
  access?: TAdminBillingAccessFilter;
  sort?: TAdminBillingUserSort;
  limit?: number;
  offset?: number;
};

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
  /** Access the pack grants or withholds while it is the user's pack */
  grants?: TPackGrants;
  /** Agent browsers one user of the pack may have open at once; absent means 1 */
  browserSessions?: number;
};

/** `PUT /api/admin/balance/packs`: the whole pack list as the admin page saves it. */
export type TAdminBillingPacksUpdate = { packs: TAdminBillingPack[] };

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

/** `POST /api/admin/balance/grant-bulk`: one pack or credit amount to several users. */
export type TAdminBillingBulkGrantRequest =
  | { userIds: string[]; packId: string }
  | { userIds: string[]; credits: number };

export type TAdminBillingBulkGrantResponse = {
  granted: number;
  /** Users that were not granted (gone, or the ledger write failed) */
  failed: string[];
  credits: number;
  pack: { id: string; label: string } | null;
};

/** `POST /api/admin/users/bulk-access`: one access class for several users. */
export type TAdminBulkAccessRequest = {
  userIds: string[];
  field: TAccessClass;
  /** `true` allows, `false` denies, `null` returns to the default */
  value: boolean | null;
};

export type TAdminBulkAccessResponse = { updated: number; notFound: string[] };

/** `GET|PUT /api/admin/balance/gifts`: amounts in credits ($1 = 1,000,000) */
export type TAdminGiftSettings = {
  startBalance: number;
  referral: {
    enabled: boolean;
    referrerCredits: number;
    inviteeCredits: number;
    maxRewardsPerReferrer: number;
  };
  changedAt?: string;
};

export type TAdminGiftUpdate = {
  startBalance?: number;
  referral?: Partial<TAdminGiftSettings['referral']>;
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

/** `PATCH /api/admin/users/:id/browser-access`: `true`/`false` sets the override, `null` clears it */
export type TAdminBrowserAccessRequest = { userId: string; browserAccess: boolean | null };

export type TAdminBrowserAccessResponse = { id: string; browserAccess: boolean | null };

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
