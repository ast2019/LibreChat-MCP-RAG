import { logger } from '@librechat/data-schemas';
import { SystemRoles, normalizeIranianMobile } from 'librechat-data-provider';
import type {
  IUser,
  AppConfig,
  NewUserData,
  CreateUserIfAbsentResult,
} from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { GetAppConfigOptions } from '~/app/service';
import { resolveAppConfigForUser } from '~/app/resolve';

type AdminRequest = Request & { user?: IUser & { id?: string } };
type GetAppConfig = (options: GetAppConfigOptions) => Promise<AppConfig>;

export interface AdminCreateUserDeps {
  getAppConfig: GetAppConfig;
  createUserIfAbsent: (
    data: NewUserData,
    balanceConfig?: AppConfig['balance'],
  ) => Promise<CreateUserIfAbsentResult>;
  hashSecret: (plain: string) => Promise<string>;
  /** Whether the requester may hand out the ADMIN role (role management, not just users). */
  canAssignAdmin: (req: AdminRequest) => Promise<boolean>;
  minPasswordLength?: number;
}

/** The created account as the admin users table needs it. */
export interface AdminCreatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

type ValidationError = { status: number; error: { code: string; message: string } };

const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const invalid = (code: string, message: string): ValidationError => ({
  status: 400,
  error: { code, message },
});

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Validates an admin's new-user form. An email account signs in with a password, so one is
 * required; a phone-only account signs in with a one-time code, so the password is optional.
 */
export function parseAdminCreateUser(
  body: unknown,
  minPasswordLength = 8,
):
  | {
      ok: true;
      value: {
        name: string;
        email?: string;
        phone?: string;
        password?: string;
        role: SystemRoles;
      };
    }
  | ({ ok: false } & ValidationError) {
  const source = (body ?? {}) as Record<string, unknown>;

  const name = readOptionalString(source.name);
  if (name == null || name.length < 2 || name.length > MAX_NAME_LENGTH) {
    return { ok: false, ...invalid('invalid_name', 'Name must be 2 to 80 characters') };
  }

  const rawEmail = readOptionalString(source.email);
  const email = rawEmail?.toLowerCase();
  if (email != null && (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) {
    return { ok: false, ...invalid('invalid_email', 'Email is not valid') };
  }

  const rawPhone = readOptionalString(source.phone);
  const phone = rawPhone != null ? normalizeIranianMobile(rawPhone) : undefined;
  if (phone === null) {
    return { ok: false, ...invalid('invalid_phone', 'Phone is not a valid Iranian mobile') };
  }

  if (email == null && phone == null) {
    return { ok: false, ...invalid('contact_required', 'Send an email or a phone number') };
  }

  const password = typeof source.password === 'string' ? source.password : '';
  if (password === '' && email != null) {
    return { ok: false, ...invalid('password_required', 'An email account needs a password') };
  }
  if (
    password !== '' &&
    (password.length < minPasswordLength ||
      password.length > MAX_PASSWORD_LENGTH ||
      password.trim().length === 0)
  ) {
    return {
      ok: false,
      ...invalid('invalid_password', `Password must be ${minPasswordLength} to 128 characters`),
    };
  }

  const role = source.role ?? SystemRoles.USER;
  if (role !== SystemRoles.USER && role !== SystemRoles.ADMIN) {
    return { ok: false, ...invalid('invalid_role', 'Role must be USER or ADMIN') };
  }

  return {
    ok: true,
    value: {
      name,
      ...(email != null ? { email } : {}),
      ...(phone != null ? { phone } : {}),
      ...(password !== '' ? { password } : {}),
      role,
    },
  };
}

/**
 * Lets an admin create an account from the users tab. The admin vouches for the contact
 * details, so they are stored as verified and no verification email or code is sent. The
 * account gets the start balance of its role, like a self-registered one.
 */
export function createAdminCreateUserHandler(deps: AdminCreateUserDeps) {
  return async function createUser(req: AdminRequest, res: Response): Promise<Response> {
    try {
      const parsed = parseAdminCreateUser(req.body, deps.minPasswordLength);
      if (!parsed.ok) {
        return res.status(parsed.status).json({ error: parsed.error });
      }
      const { name, email, phone, password, role } = parsed.value;

      if (role === SystemRoles.ADMIN && !(await deps.canAssignAdmin(req))) {
        return res.status(403).json({
          error: { code: 'admin_role_forbidden', message: 'You cannot create admins' },
        });
      }

      const appConfig = await resolveAppConfigForUser(deps.getAppConfig, {
        role,
        tenantId: req.user?.tenantId,
      });

      const base = {
        provider: 'local',
        name,
        role,
        emailVerified: email != null,
        ...(phone != null ? { phone, phoneVerified: true } : {}),
        ...(password != null ? { password: await deps.hashSecret(password) } : {}),
      };
      /** Parsing guarantees an email or a phone. */
      const data: NewUserData =
        email != null ? { ...base, email } : { ...base, phone: phone as string };

      const created = await deps.createUserIfAbsent(data, appConfig?.balance);
      if (!created.ok) {
        return res.status(409).json({
          error: { code: 'user_exists', message: 'An account already uses this email or phone' },
        });
      }

      const user = created.value;
      const id = user._id.toString();
      logger.info(`[adminBalance] ${req.user?.id} created user ${id} with role ${role}`);
      const body: AdminCreatedUser = {
        id,
        name: user.name ?? name,
        email: user.email ?? '',
        phone: user.phone ?? '',
        role: user.role ?? role,
      };
      return res.status(201).json({ user: body });
    } catch (error) {
      logger.error('[adminBalance] create user failed', error);
      return res.status(500).json({
        error: { code: 'create_user_failed', message: 'Could not create the user' },
      });
    }
  };
}
