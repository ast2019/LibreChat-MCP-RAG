import type { Connection } from 'mongoose';
import { buildIndexWithRetry } from '~/utils/retry';
import logger from '~/config/winston';

/** The pre-phone index: unique on a missing email, so it admits one phone-only user per tenant. */
const LEGACY_EMAIL_INDEX = 'email_1_tenantId_1';
const EMAIL_INDEX_KEYS = { tenantId: 1, email: 1 } as const;
const PHONE_INDEX_KEYS = { phone: 1, tenantId: 1 } as const;

export interface UserIdentityIndexMigrationResult {
  created: string[];
  dropped: string[];
}

interface IndexInfo {
  name?: string;
  unique?: boolean;
  partialFilterExpression?: object;
}

/**
 * Replaces the legacy non-partial `{ email, tenantId }` unique index with the partial one the user
 * schema now declares, and ensures the partial phone index exists. Idempotent and safe on a fresh
 * database. The replacement is built before the legacy index is dropped, so email uniqueness is
 * enforced throughout; a build failure (for example duplicate data) throws and leaves the legacy
 * index in place.
 */
export async function migrateUserIdentityIndexes(
  connection: Connection,
): Promise<UserIdentityIndexMigrationResult> {
  const result: UserIdentityIndexMigrationResult = { created: [], dropped: [] };
  const collection = connection.db!.collection('users');

  let indexes: IndexInfo[];
  try {
    indexes = await collection.indexes();
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 26) {
      return result;
    }
    throw err;
  }

  const legacy = indexes.find(
    (idx) => idx.name === LEGACY_EMAIL_INDEX && idx.unique && !idx.partialFilterExpression,
  );
  const names = new Set(indexes.map((idx) => idx.name));

  if (!names.has('tenantId_1_email_1')) {
    await buildIndexWithRetry(
      () =>
        collection.createIndex(EMAIL_INDEX_KEYS, {
          unique: true,
          partialFilterExpression: { email: { $type: 'string' } },
        }),
      'users.tenantId_1_email_1',
    );
    result.created.push('users.tenantId_1_email_1');
  }
  if (!names.has('phone_1_tenantId_1')) {
    await buildIndexWithRetry(
      () =>
        collection.createIndex(PHONE_INDEX_KEYS, {
          unique: true,
          partialFilterExpression: { phone: { $type: 'string' } },
        }),
      'users.phone_1_tenantId_1',
    );
    result.created.push('users.phone_1_tenantId_1');
  }

  if (legacy) {
    await collection.dropIndex(LEGACY_EMAIL_INDEX);
    result.dropped.push(`users.${LEGACY_EMAIL_INDEX}`);
  }

  if (result.created.length || result.dropped.length) {
    logger.info('[UserIdentityIndexes] Migrated user identity indexes', result);
  }
  return result;
}
