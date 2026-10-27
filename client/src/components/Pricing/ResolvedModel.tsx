import { memo } from 'react';
import type { TMessage } from 'librechat-data-provider';
import useLocalize from '~/hooks/useLocalize';
import { formatModelName } from './name';
import cn from '~/utils/cn';

/** The concrete model id the provider reported for an assistant message, when it was saved
 *  with one (`metadata.resolvedModel`); older messages and user turns have none. */
export function getResolvedModel(message?: Pick<TMessage, 'metadata'> | null): string | undefined {
  const value = message?.metadata?.resolvedModel;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** «Claude Sonnet 5.5» beside the sender, with the raw id on hover. */
function ResolvedModel({ id, className }: { id: string; className?: string }) {
  const localize = useLocalize();
  const name = formatModelName(id);
  return (
    <span
      title={id}
      data-testid="resolved-model"
      className={cn('text-text-secondary min-w-0 shrink truncate text-xs font-normal', className)}
    >
      <span className="sr-only">{localize('com_ui_message_resolved_model', { 0: name })}</span>
      <span aria-hidden="true">{name}</span>
    </span>
  );
}

export default memo(ResolvedModel);
