import { useEffect } from 'react';
import { Package } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '@librechat/client';
import { loginPage, registerPage } from 'librechat-data-provider';
import type { TPublicPack } from 'librechat-data-provider';
import type { TLoginLayoutContext } from '~/common';
import type { TranslationKeys } from '~/hooks';
import { formatPackPrice, formatPackUsd } from '~/utils/balance';
import { usePublicPacksQuery } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';

const INCLUDES_KEYS: Record<TPublicPack['includes'][number], TranslationKeys> = {
  local: 'com_ui_packs_includes_local',
  private: 'com_ui_packs_includes_private',
  media: 'com_ui_packs_includes_media',
  api: 'com_ui_packs_includes_api',
  browser: 'com_ui_packs_includes_browser',
};

/** Where buying a pack starts: checkout after sign-in, with the pack already chosen. */
const checkoutPath = (packId: string) => `/payment?pack=${encodeURIComponent(packId)}`;

/**
 * The public «بسته‌ها» page: every pack and its price, before sign-in. Prices use the same
 * formula and currency as checkout; buying signs the visitor in (or up) first.
 */
export default function PublicPacks() {
  const localize = useLocalize();
  const context = useOutletContext<TLoginLayoutContext | undefined>();
  const packs = usePublicPacksQuery();
  const setHeaderText = context?.setHeaderText;

  useEffect(() => {
    setHeaderText?.('com_ui_packs_title');
  }, [setHeaderText]);

  const currency = packs.data?.currency ?? undefined;
  const list = packs.data?.packs ?? [];
  const registrationEnabled = context?.startupConfig?.registrationEnabled === true;

  if (packs.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label={localize('com_ui_loading')}>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (packs.isError) {
    return (
      <div className="space-y-3 text-center">
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_ui_packs_load_error')}
        </p>
        <Button size="compact" variant="outline" onClick={() => packs.refetch()}>
          {localize('com_ui_payment_retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-text-secondary text-center text-sm">{localize('com_ui_packs_intro')}</p>
      {list.length === 0 ? (
        <EmptyState icon={Package} title={localize('com_ui_packs_empty')} />
      ) : (
        <ul className="space-y-3" data-testid="public-pack-list">
          {list.map((pack) => {
            const price = formatPackPrice(pack.credits, currency);
            const usd = localize('com_ui_payment_pack_usd', { 0: formatPackUsd(pack.credits) });
            /** The login page sends a signed-in visitor straight on to `redirect_to`. */
            const buyHref = `${loginPage()}?redirect_to=${encodeURIComponent(checkoutPath(pack.id))}`;
            return (
              <li
                key={pack.id}
                data-testid="public-pack"
                className="border-border-light bg-surface-secondary rounded-xl border p-4"
              >
                <div className="flex items-start gap-3">
                  <Package
                    className="text-text-secondary mt-0.5 size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary text-sm font-semibold">{pack.label}</p>
                    {pack.includes.length > 0 && (
                      <ul className="text-text-secondary mt-1 space-y-0.5 text-xs">
                        {pack.includes.map((key) => (
                          <li key={key}>
                            {key === 'browser' && pack.browserSessions
                              ? localize('com_ui_packs_includes_browser_sessions', {
                                  0: String(pack.browserSessions),
                                })
                              : localize(INCLUDES_KEYS[key])}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-end whitespace-nowrap">
                    <p className="text-text-primary text-sm font-semibold">{price ?? usd}</p>
                    {price != null && (
                      <p className="text-text-secondary text-xs" data-testid="public-pack-usd">
                        {usd}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button asChild size="sm">
                    <a href={buyHref}>{localize('com_ui_packs_buy')}</a>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-text-secondary text-center text-xs">{localize('com_ui_packs_note')}</p>
      <p className="text-text-secondary text-center text-sm">
        <a href={loginPage()} className="text-accent-primary font-medium hover:underline">
          {localize('com_auth_login')}
        </a>
        {registrationEnabled && (
          <>
            {' · '}
            <a href={registerPage()} className="text-accent-primary font-medium hover:underline">
              {localize('com_auth_sign_up')}
            </a>
          </>
        )}
      </p>
    </div>
  );
}
