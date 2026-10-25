import { useId } from 'react';
import { useAtom } from 'jotai';
import { Switch } from '@librechat/client';
import { adminAdvancedModeAtom } from '~/store/admin';
import { useLocalize } from '~/hooks';

/**
 * The admin's own builder tools. Off (default), the admin's chat is the users' chat; on, the
 * admin's full permissions apply: agent builder, prompts, MCP, Skills, marketplace and the
 * per-feature admin buttons appear in the chat sidebar.
 */
export default function Advanced() {
  const localize = useLocalize();
  const [advanced, setAdvanced] = useAtom(adminAdvancedModeAtom);
  const id = useId();

  return (
    <section aria-labelledby="admin-advanced" className="space-y-3">
      <div className="border-border-light flex items-start gap-4 rounded-xl border p-4">
        <div className="min-w-0 flex-1">
          <label id="admin-advanced" htmlFor={id} className="text-text-primary text-sm font-medium">
            {localize('com_admin_advanced_title')}
          </label>
          <p className="text-text-secondary mt-1 text-xs">{localize('com_admin_advanced_desc')}</p>
        </div>
        <Switch
          id={id}
          aria-labelledby="admin-advanced"
          checked={advanced}
          onCheckedChange={setAdvanced}
          data-testid="admin-advanced-switch"
        />
      </div>
      <p className="text-text-secondary text-xs">{localize('com_admin_advanced_note')}</p>
    </section>
  );
}
