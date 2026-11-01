import { useEffect, useId, useState } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { ACCESS_CLASSES, CREDITS_PER_USD, MAX_BROWSER_SESSIONS } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Spinner,
  Dropdown,
  Skeleton,
  useToastContext,
} from '@librechat/client';
import type { TAccessClass, TAdminBillingPack, TPackGrants } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminBillingPacksQuery, useAdminBillingPacksMutation } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { formatList, formatLocal } from './format';
import { ACCESS_LABELS } from './accessLabels';
import { useLocalize } from '~/hooks';

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_PACKS = 20;
const MAX_USD = 1000;

type GrantChoice = 'default' | 'include' | 'exclude';

type Row = {
  /** Stable React key; never sent */
  key: string;
  id: string;
  label: string;
  usd: string;
  description: string;
  grants: TPackGrants;
  /** Browsers one user of the pack may have open at once, as typed; empty means 1 */
  browserSessions: string;
  /** Not saved yet, so its id may still change */
  isNew: boolean;
};

type RowErrors = Partial<
  Record<'id' | 'label' | 'usd' | 'description' | 'browserSessions', TranslationKeys>
>;

/** The browser count typed by the admin; null when empty, NaN when invalid. */
function toBrowserSessions(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const count = Number(trimmed);
  return Number.isInteger(count) && count >= 1 && count <= MAX_BROWSER_SESSIONS ? count : NaN;
}

const toUsd = (credits: number) => String(Math.round((credits / CREDITS_PER_USD) * 100) / 100);

function toRow(pack: TAdminBillingPack): Row {
  return {
    key: pack.id,
    id: pack.id,
    label: pack.label,
    usd: toUsd(pack.credits),
    description: pack.description ?? '',
    grants: { ...pack.grants },
    browserSessions: pack.browserSessions != null ? String(pack.browserSessions) : '',
    isNew: false,
  };
}

/** Dollars typed by the admin as whole credits; null when not a valid pack amount. */
function toCredits(usd: string): number | null {
  const value = Number.parseFloat(usd.trim());
  if (!Number.isFinite(value) || value <= 0 || value > MAX_USD) {
    return null;
  }
  return Math.round(value * CREDITS_PER_USD);
}

function validate(rows: Row[]): RowErrors[] {
  const ids = rows.map((row) => row.id.trim());
  return rows.map((row, index) => {
    const errors: RowErrors = {};
    const id = ids[index];
    if (!ID_PATTERN.test(id) || id.length > 64) {
      errors.id = 'com_admin_packs_error_id';
    } else if (ids.indexOf(id) !== index) {
      errors.id = 'com_admin_packs_error_id_taken';
    }
    if (row.label.trim() === '' || row.label.trim().length > 80) {
      errors.label = 'com_admin_packs_error_label';
    }
    if (toCredits(row.usd) == null) {
      errors.usd = 'com_admin_packs_error_price';
    }
    if (row.description.trim().length > 200) {
      errors.description = 'com_admin_packs_error_description';
    }
    if (Number.isNaN(toBrowserSessions(row.browserSessions))) {
      errors.browserSessions = 'com_admin_packs_error_browser_sessions';
    }
    return errors;
  });
}

function toPack(row: Row): TAdminBillingPack {
  const description = row.description.trim();
  const grants = Object.fromEntries(
    Object.entries(row.grants).filter(([, value]) => typeof value === 'boolean'),
  ) as TPackGrants;
  const browserSessions = toBrowserSessions(row.browserSessions);
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    credits: toCredits(row.usd) as number,
    ...(description !== '' && { description }),
    ...(Object.keys(grants).length > 0 && { grants }),
    ...(browserSessions != null && { browserSessions }),
  };
}

const sameList = (a: TAdminBillingPack[], b: TAdminBillingPack[]) =>
  JSON.stringify(a) === JSON.stringify(b);

function toChoice(value?: boolean): GrantChoice {
  if (value === true) {
    return 'include';
  }
  return value === false ? 'exclude' : 'default';
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: TranslationKeys;
  hint?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
}) {
  const localize = useLocalize();
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ? localize(error) : hint;
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, describedBy: note ? noteId : undefined, invalid: error != null })}
      {note && (
        <p
          id={noteId}
          className={error ? 'text-text-destructive text-xs' : 'text-text-secondary text-xs'}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function PackCard({
  row,
  errors,
  onChange,
  onRemove,
}: {
  row: Row;
  errors: RowErrors;
  onChange: (row: Row) => void;
  onRemove: () => void;
}) {
  const localize = useLocalize();
  const { currency } = useBalanceDisplay();
  const credits = toCredits(row.usd);
  const local = credits != null ? formatLocal(credits, currency) : null;
  const title = row.label.trim() || localize('com_admin_packs_untitled');

  const setGrant = (field: TAccessClass, choice: GrantChoice) => {
    const grants = { ...row.grants };
    if (choice === 'default') {
      delete grants[field];
    } else {
      grants[field] = choice === 'include';
    }
    onChange({ ...row, grants });
  };

  const grantOptions = [
    { value: 'default', label: localize('com_admin_packs_grant_default') },
    { value: 'include', label: localize('com_admin_packs_grant_include') },
    { value: 'exclude', label: localize('com_admin_packs_grant_exclude') },
  ];

  return (
    <li className="border-border-light space-y-4 rounded-xl border p-4" data-testid="admin-pack">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-text-primary text-base font-semibold" dir="auto">
          {title}
        </h3>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={onRemove}
          aria-label={localize('com_admin_packs_remove', { 0: title })}
          title={localize('com_admin_packs_remove', { 0: title })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={localize('com_admin_packs_label')} error={errors.label}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              dir="auto"
              value={row.label}
              maxLength={80}
              onChange={(event) => onChange({ ...row, label: event.target.value })}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          label={localize('com_admin_packs_price')}
          error={errors.usd}
          hint={local != null ? `≈ ${local}` : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <div className="flex items-center gap-2">
              <Input
                id={id}
                dir="ltr"
                inputMode="decimal"
                value={row.usd}
                onChange={(event) => onChange({ ...row, usd: event.target.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className="max-w-32"
              />
              <span className="text-text-secondary text-sm">$</span>
            </div>
          )}
        </Field>
        <Field
          label={localize('com_admin_packs_id')}
          error={errors.id}
          hint={localize(row.isNew ? 'com_admin_packs_id_hint' : 'com_admin_packs_id_fixed')}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              dir="ltr"
              value={row.id}
              readOnly={!row.isNew}
              maxLength={64}
              onChange={(event) => onChange({ ...row, id: event.target.value.toLowerCase() })}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field
          label={localize('com_admin_packs_note')}
          error={errors.description}
          hint={localize('com_admin_packs_note_hint')}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              dir="auto"
              value={row.description}
              maxLength={200}
              onChange={(event) => onChange({ ...row, description: event.target.value })}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-text-primary text-sm font-medium">
          {localize('com_admin_packs_grants')}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACCESS_CLASSES.map((field) => {
            const label = localize(ACCESS_LABELS[field].full);
            return (
              <div key={field} className="flex items-center justify-between gap-3">
                <span className="text-text-secondary text-sm">{label}</span>
                <Dropdown
                  variant="compact"
                  value={toChoice(row.grants[field])}
                  options={grantOptions}
                  onChange={(value) => setGrant(field, value as GrantChoice)}
                  ariaLabel={`${label}: ${title}`}
                  testId={`pack-grant-${field}-${row.key}`}
                  sizeClasses="z-50"
                />
              </div>
            );
          })}
        </div>
        {row.grants.browser === true && (
          <Field
            label={localize('com_admin_packs_browser_sessions')}
            error={errors.browserSessions}
            hint={localize('com_admin_packs_browser_sessions_hint')}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                placeholder="1"
                value={row.browserSessions}
                onChange={(event) => onChange({ ...row, browserSessions: event.target.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className="max-w-20"
                data-testid={`pack-browser-sessions-${row.key}`}
              />
            )}
          </Field>
        )}
      </fieldset>
    </li>
  );
}

let newPackCount = 0;

/**
 * The packs users can buy or be given: name, price, an admin note and what each includes.
 * The list is saved as a whole and applies from the next request; users keep the credit of a
 * pack that is changed or removed.
 */
export default function Packs() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const packs = useAdminBillingPacksQuery();
  const save = useAdminBillingPacksMutation();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (packs.data && rows == null) {
      setRows(packs.data.packs.map(toRow));
    }
  }, [packs.data, rows]);

  if (packs.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_load_error')}
        </p>
        <Button size="sm" variant="outline" onClick={() => void packs.refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  }
  if (rows == null || packs.data == null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  const saved = packs.data.packs;
  const errors = validate(rows);
  const valid = errors.every((rowErrors) => Object.keys(rowErrors).length === 0);
  const next = valid ? rows.map(toPack) : null;
  const changed = next == null || !sameList(next, saved);
  const removed = saved.filter((pack) => !rows.some((row) => !row.isNew && row.id === pack.id));

  const update = (index: number, row: Row) =>
    setRows((current) => current?.map((item, i) => (i === index ? row : item)) ?? current);

  const remove = (index: number) =>
    setRows((current) => current?.filter((_, i) => i !== index) ?? current);

  const add = () => {
    newPackCount += 1;
    const taken = new Set(rows.map((row) => row.id));
    let n = rows.length + 1;
    while (taken.has(`pack-${n}`)) {
      n += 1;
    }
    setRows([
      ...rows,
      {
        key: `new-${newPackCount}`,
        id: `pack-${n}`,
        label: '',
        usd: '',
        description: '',
        grants: {},
        browserSessions: '',
        isNew: true,
      },
    ]);
  };

  const submit = () => {
    if (next == null) {
      return;
    }
    save.mutate(
      { packs: next },
      {
        onSuccess: (data) => {
          setRows(data.packs.map(toRow));
          showToast({ status: 'success', message: localize('com_admin_packs_saved') });
        },
        onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
      },
    );
  };

  return (
    <section aria-labelledby="admin-packs" className="space-y-4">
      <div className="border-border-light bg-surface-secondary flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
        <div className="bg-surface-tertiary flex size-11 shrink-0 items-center justify-center rounded-xl">
          <Package className="text-text-secondary size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="admin-packs" className="text-text-primary text-lg font-semibold">
            {localize('com_admin_packs_title')}
          </h2>
          <p className="text-text-secondary mt-1 text-sm">{localize('com_admin_packs_intro')}</p>
        </div>
      </div>

      {!packs.data.enabled && (
        <p role="status" className="text-text-warning text-sm">
          {localize('com_admin_packs_balance_off')}
        </p>
      )}

      <p className="text-text-secondary text-xs">{localize('com_admin_packs_grants_hint')}</p>

      {rows.length === 0 ? (
        <p className="text-text-secondary border-border-light rounded-xl border px-4 py-8 text-center text-sm">
          {localize('com_admin_packs_empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <PackCard
              key={row.key}
              row={row}
              errors={errors[index]}
              onChange={(value) => update(index, value)}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}

      {removed.length > 0 && (
        <p role="status" className="text-text-warning text-sm">
          {localize('com_admin_packs_removed_note', {
            0: formatList(removed.map((pack) => pack.label)),
          })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={add} disabled={rows.length >= MAX_PACKS}>
          <Plus className="me-1.5 size-4" aria-hidden="true" />
          {localize('com_admin_packs_add')}
        </Button>
        <span className="flex-1" />
        {changed && (
          <Button variant="ghost" onClick={() => setRows(saved.map(toRow))}>
            {localize('com_admin_packs_reset')}
          </Button>
        )}
        <Button
          onClick={submit}
          disabled={!packs.data.enabled || !valid || !changed || save.isLoading}
          aria-busy={save.isLoading}
          data-testid="admin-packs-save"
        >
          {save.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
        </Button>
      </div>
      {!valid && (
        <p className="text-text-destructive text-xs">{localize('com_admin_packs_fix_errors')}</p>
      )}
    </section>
  );
}
