import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import copy from 'copy-to-clipboard';
import { Constants } from 'librechat-data-provider';
import type { TStartupConfig } from 'librechat-data-provider';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

const UNKNOWN_PLACEHOLDER = '—';

function formatBuildDate(raw: string | null | undefined): string {
  if (!raw) {
    return UNKNOWN_PLACEHOLDER;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

function buildDiagnosticsBlob(
  appVersion: string,
  librechatVersion: string,
  buildInfo: TStartupConfig['buildInfo'] | undefined,
): string {
  const lines: string[] = [
    `HiveGPT version: ${appVersion}`,
    `LibreChat (upstream): ${librechatVersion}`,
    `Commit: ${buildInfo?.commit ?? UNKNOWN_PLACEHOLDER}`,
    `Branch: ${buildInfo?.branch ?? UNKNOWN_PLACEHOLDER}`,
    `Build date: ${formatBuildDate(buildInfo?.buildDate)}`,
    `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : UNKNOWN_PLACEHOLDER}`,
  ];
  return lines.join('\n');
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text-primary text-end font-mono text-xs break-all">{value}</dd>
    </div>
  );
}

function About() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildInfo = startupConfig?.buildInfo;
  const appVersion = startupConfig?.appVersion ?? Constants.APP_VERSION;
  const librechatVersion = startupConfig?.librechatVersion ?? Constants.VERSION;
  const changelog = startupConfig?.changelog ?? [];

  const diagnosticsBlob = useMemo(
    () => buildDiagnosticsBlob(appVersion, librechatVersion, buildInfo),
    [appVersion, librechatVersion, buildInfo],
  );

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(() => {
    const succeeded = copy(diagnosticsBlob, { format: 'text/plain' });
    if (!succeeded) {
      return;
    }
    setIsCopied(true);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = setTimeout(() => setIsCopied(false), 2000);
  }, [diagnosticsBlob]);

  return (
    <div className="text-text-primary flex flex-col text-sm">
      <dl className="divide-border-light flex flex-col divide-y">
        <Row label={localize('com_nav_about_version')} value={appVersion} />
        <Row label={localize('com_nav_about_librechat_version')} value={librechatVersion} />
        <Row
          label={localize('com_nav_about_commit')}
          value={buildInfo?.commitShort ?? UNKNOWN_PLACEHOLDER}
        />
        <Row
          label={localize('com_nav_about_branch')}
          value={buildInfo?.branch ?? UNKNOWN_PLACEHOLDER}
        />
        <Row
          label={localize('com_nav_about_build_date')}
          value={formatBuildDate(buildInfo?.buildDate)}
        />
      </dl>

      <div className="border-border-light mt-4 border-t pt-4">
        <h3 className="text-text-primary mb-2 text-sm font-medium">
          {localize('com_nav_about_changelog')}
        </h3>
        {changelog.length === 0 ? (
          <p className="text-text-secondary text-xs">{localize('com_nav_about_changelog_empty')}</p>
        ) : (
          <ul className="space-y-3">
            {changelog.slice(0, 5).map((entry) => (
              <li key={entry.version} className="text-xs">
                <div className="text-text-primary font-medium">
                  {entry.version}
                  {entry.date ? (
                    <span className="text-text-tertiary ms-2 font-normal">{entry.date}</span>
                  ) : null}
                </div>
                {entry.highlights.length > 0 && (
                  <ul className="text-text-secondary mt-1 list-disc space-y-0.5 ps-4">
                    {entry.highlights.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-text-tertiary mt-2 text-xs">{localize('com_nav_about_changelog_more')}</p>
      </div>

      <div className="border-border-light mt-4 flex flex-col items-start gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-text-secondary min-w-0 flex-1 text-xs">
          {localize('com_nav_about_diagnostics_description')}
        </p>
        <CopyButton
          isCopied={isCopied}
          onClick={handleCopy}
          label={localize('com_nav_about_diagnostics_copy')}
          className="border-border-light bg-surface-secondary text-text-primary hover:bg-surface-tertiary ms-0 shrink-0 gap-2 self-start rounded-lg border px-3 py-1.5 text-xs font-medium sm:self-auto"
        />
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {isCopied ? localize('com_ui_copied') : ''}
        </span>
      </div>
    </div>
  );
}

export default memo(About);
