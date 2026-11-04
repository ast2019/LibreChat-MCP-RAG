import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import type { Connection } from 'mongoose';
import logger from '~/config/winston';

const LEGACY_ROLE = 'OPERATOR';

export interface OperatorToManagerMigrationResult {
  usersUpdated: number;
  grantsUpdated: number;
  roleRenamed: boolean;
  roleDropped: boolean;
}

/**
 * Renames the short-lived OPERATOR system grade to MANAGER on Users, Roles and
 * SystemGrants. Idempotent: a deployment that never had OPERATOR is a no-op.
 * Run before `initializeRoles` / `seedSystemGrants` so MANAGER is seeded cleanly.
 */
export async function migrateOperatorToManagerRole(
  connection: Connection,
): Promise<OperatorToManagerMigrationResult> {
  const result: OperatorToManagerMigrationResult = {
    usersUpdated: 0,
    grantsUpdated: 0,
    roleRenamed: false,
    roleDropped: false,
  };

  const db = connection.db;
  if (!db) {
    return result;
  }

  const users = await db.collection('users').updateMany(
    { role: LEGACY_ROLE },
    { $set: { role: SystemRoles.MANAGER } },
  );
  result.usersUpdated = users.modifiedCount;

  const grants = await db.collection('systemgrants').updateMany(
    {
      principalType: PrincipalType.ROLE,
      principalId: LEGACY_ROLE,
    },
    { $set: { principalId: SystemRoles.MANAGER } },
  );
  result.grantsUpdated = grants.modifiedCount;

  const roles = db.collection('roles');
  const legacyRole = await roles.findOne({ name: LEGACY_ROLE });
  if (legacyRole) {
    const managerRole = await roles.findOne({ name: SystemRoles.MANAGER });
    if (!managerRole) {
      await roles.updateOne({ name: LEGACY_ROLE }, { $set: { name: SystemRoles.MANAGER } });
      result.roleRenamed = true;
    } else {
      await roles.deleteOne({ name: LEGACY_ROLE });
      result.roleDropped = true;
    }
  }

  if (
    result.usersUpdated ||
    result.grantsUpdated ||
    result.roleRenamed ||
    result.roleDropped
  ) {
    logger.info('[OperatorToManager] Migrated OPERATOR system grade to MANAGER', result);
  }

  return result;
}
