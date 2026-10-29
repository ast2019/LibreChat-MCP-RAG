import { SystemRoles } from 'librechat-data-provider';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import { useAdminSetUserRoleMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

function serverMessageOf(error: unknown): string | undefined {
  const message = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof message === 'string' ? message : undefined;
}

/** Confirms making a user an admin, or taking the admin role away. */
export default function RoleDialog({
  user,
  onClose,
}: {
  user: TAdminBillingUser;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const setRole = useAdminSetUserRoleMutation();
  const makeAdmin = user.role !== SystemRoles.ADMIN;
  const who = user.name || user.username || user.email || user.phone || '';

  const submit = () => {
    setRole.mutate(
      { userId: user.id, admin: makeAdmin },
      {
        onSuccess: () => {
          showToast({
            status: 'success',
            message: localize(makeAdmin ? 'com_admin_role_promoted' : 'com_admin_role_demoted', {
              0: who,
            }),
          });
          onClose();
        },
        onError: (error) => {
          const lastAdmin = serverMessageOf(error)?.includes('last admin') === true;
          showToast({
            status: 'error',
            message: localize(
              lastAdmin ? 'com_admin_role_error_last_admin' : 'com_admin_role_error',
            ),
          });
        },
      },
    );
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize(makeAdmin ? 'com_admin_role_promote_title' : 'com_admin_role_demote_title')}
        className="w-11/12 md:max-w-md"
        showCloseButton={false}
        main={
          <p className="text-text-secondary text-sm">
            {localize(makeAdmin ? 'com_admin_role_promote_body' : 'com_admin_role_demote_body', {
              0: who,
            })}
          </p>
        }
        buttons={
          <Button
            onClick={submit}
            disabled={setRole.isLoading}
            aria-busy={setRole.isLoading}
            variant={makeAdmin ? 'default' : 'destructive'}
          >
            {setRole.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize(makeAdmin ? 'com_admin_role_promote' : 'com_admin_role_demote')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
