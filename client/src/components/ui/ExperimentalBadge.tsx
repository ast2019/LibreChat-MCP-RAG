import { Chip } from '@librechat/client';
import { useLocalize } from '~/hooks';

/** «آزمایشی»: a feature that works and is still being shaped, marked wherever it is offered. */
export default function ExperimentalBadge({ className }: { className?: string }) {
  const localize = useLocalize();
  return (
    <Chip tone="merged" size="xs" className={className}>
      {localize('com_ui_experimental')}
    </Chip>
  );
}
