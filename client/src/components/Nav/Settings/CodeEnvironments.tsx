import { useEffect, useId, useState } from 'react';
import {
  createCodeWorkerRunCommand,
  createCodeWorkerSetupCommand,
  isCodeWorkerShell,
} from 'librechat-data-provider';
import {
  Button,
  Chip,
  Input,
  Dropdown,
  Label,
  OGDialog,
  OGDialogTemplate,
  OGDialogTrigger,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type {
  CodeEnvironmentPermissionDecision,
  TCodeEnvironmentSummary,
  CodeWorkerShell,
} from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { CodeEnvironmentPairingResponse } from '~/data-provider/CodeEnvironments';
import {
  useCodeEnvironmentsQuery,
  useCodeEnvironmentStatusQuery,
  useDeleteCodeEnvironmentMutation,
  usePairCodeEnvironmentMutation,
  useUpdateCodeEnvironmentSettingsMutation,
} from '~/data-provider';
import { getResponseStatus } from '~/utils';
import { useLocalize } from '~/hooks';

const statusPresentation = {
  offline: { label: 'com_ui_code_environment_status_offline', tone: 'error' },
  starting: { label: 'com_ui_code_environment_status_starting', tone: 'warning' },
  ready: { label: 'com_ui_code_environment_status_ready', tone: 'success' },
} as const;

function EnvironmentStatus({
  environmentId,
  onStatus,
}: {
  environmentId: string;
  onStatus?: (status: 'offline' | 'starting' | 'ready' | 'unavailable' | 'checking') => void;
}) {
  const localize = useLocalize();
  const query = useCodeEnvironmentStatusQuery(environmentId);
  const status = query.isLoading
    ? 'checking'
    : query.isError || query.data == null
      ? 'unavailable'
      : query.data.status;
  useEffect(() => {
    onStatus?.(status);
  }, [onStatus, status]);
  if (status === 'checking') {
    return <Chip tone="neutral">{localize('com_ui_code_environment_status_checking')}</Chip>;
  }
  if (status === 'unavailable') {
    return <Chip tone="warning">{localize('com_ui_code_environment_status_unavailable')}</Chip>;
  }
  const presentation = statusPresentation[status];
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <Chip tone={presentation.tone}>{localize(presentation.label)}</Chip>
      {query.data?.sandboxProfile != null && (
        <span className="text-text-tertiary max-w-48 truncate text-xs">
          {[query.data.sandboxProfile, ...(query.data.runtimes ?? [])].join(' · ')}
        </span>
      )}
    </div>
  );
}

function OfflineReconnect({ workerId }: { workerId: string }) {
  const localize = useLocalize();
  const command = createCodeWorkerRunCommand(workerId, 'posix', {
    allowWorkspaceWrites: true,
    allowWorkspaceCommands: true,
    commandPolicyPreset: 'trusted-vm',
  });
  return (
    <div className="mt-3" data-testid="code-environment-reconnect">
      <CopyBlock
        title={localize('com_ui_code_environment_reconnect_title')}
        description={localize('com_ui_code_environment_reconnect_description')}
        command={command}
      />
    </div>
  );
}

const INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/ast2019/LibreChat-MCP-RAG/main/deploy/code-worker/install-host.sh';

const HOST_PREP_COMMAND = `export INSTALL_DOCKER=1
curl -fsSL ${INSTALL_SCRIPT_URL} -o /tmp/install-host.sh
chmod +x /tmp/install-host.sh
bash /tmp/install-host.sh`;

const SYSTEMD_UNIT = `[Unit]
Description=HiveGPT attached code worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_LINUX_USER
Group=YOUR_LINUX_USER
WorkingDirectory=/srv/code-workspaces
Environment=HOME=/home/YOUR_LINUX_USER
Environment=NODE_ENV=production
Environment=LIBRECHAT_CODE_WORKER_ID=YOUR_WORKER_ID
ExecStart=/usr/bin/librechat-code run --default-workspace --allow-workspace-writes --allow-workspace-commands --command-policy-preset trusted-vm
Restart=always
RestartSec=5s
TimeoutStopSec=35s
KillMode=control-group
UMask=0077
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target`;

const SYSTEMD_ENABLE = `sudo tee /etc/systemd/system/librechat-code.service >/dev/null <<'EOF'
${SYSTEMD_UNIT}
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now librechat-code.service
sudo systemctl status librechat-code.service --no-pager`;

/** After editing the unit (worker id / policy), reload before restart or systemd keeps the old file. */
const SYSTEMD_RESTART = `sudo systemctl daemon-reload
sudo systemctl restart librechat-code.service
sudo systemctl status librechat-code.service --no-pager`;

function CopyBlock({
  title,
  description,
  command,
}: {
  title: string;
  description: string;
  command: string;
}) {
  const { showToast } = useToastContext();
  const localize = useLocalize();
  return (
    <div className="border-border-medium bg-surface-secondary flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-text-primary text-sm font-medium">{title}</p>
      <p className="text-text-secondary text-xs">{description}</p>
      <pre className="bg-surface-tertiary text-text-primary overflow-x-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap">
        {command}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            showToast({ message: localize('com_ui_copied_to_clipboard'), status: 'success' });
          } catch {
            showToast({ message: localize('com_ui_copy_failed'), status: 'error' });
          }
        }}
      >
        {localize('com_ui_copy_to_clipboard')}
      </Button>
    </div>
  );
}

function InstallGuide() {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-3" data-testid="code-environment-install-guide">
      <p className="text-text-secondary text-xs">
        {localize('com_ui_code_environment_install_intro')}
      </p>
      <CopyBlock
        title={localize('com_ui_code_environment_install_step1_title')}
        description={localize('com_ui_code_environment_install_step1_body')}
        command={HOST_PREP_COMMAND}
      />
      <p className="text-text-secondary text-xs">
        {localize('com_ui_code_environment_install_step2')}
      </p>
      <CopyBlock
        title={localize('com_ui_code_environment_install_step4_title')}
        description={localize('com_ui_code_environment_install_step4_body')}
        command={SYSTEMD_ENABLE}
      />
      <CopyBlock
        title={localize('com_ui_code_environment_install_restart_title')}
        description={localize('com_ui_code_environment_install_restart_body')}
        command={SYSTEMD_RESTART}
      />
    </div>
  );
}

function WorkerCommand({ pairing }: { pairing: CodeEnvironmentPairingResponse['pairing'] }) {
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const [shell, setShell] = useState<CodeWorkerShell>('posix');
  const command = createCodeWorkerSetupCommand(pairing, shell, {
    allowWorkspaceWrites: true,
    allowWorkspaceCommands: true,
    commandPolicyPreset: 'trusted-vm',
  });
  return (
    <div className="border-border-medium bg-surface-secondary flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-text-primary text-sm font-medium">
          {localize('com_ui_code_environment_pairing_ready')}
        </p>
        <Dropdown
          value={shell}
          options={[
            { value: 'posix', label: localize('com_ui_code_environment_shell_posix') },
            { value: 'powershell', label: localize('com_ui_code_environment_shell_powershell') },
          ]}
          onChange={(value) => {
            if (isCodeWorkerShell(value)) {
              setShell(value);
            }
          }}
          ariaLabel={localize('com_ui_code_environment_shell')}
          testId="code-environment-shell"
          className="shrink-0"
          sizeClasses="z-50 min-w-48"
        />
      </div>
      <p className="text-text-secondary text-xs">
        {localize('com_ui_code_environment_pairing_description')}
      </p>
      <pre className="bg-surface-tertiary text-text-primary overflow-x-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap">
        {command}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            showToast({ message: localize('com_ui_copied_to_clipboard'), status: 'success' });
          } catch {
            showToast({ message: localize('com_ui_copy_failed'), status: 'error' });
          }
        }}
      >
        {localize('com_ui_copy_to_clipboard')}
      </Button>
    </div>
  );
}

const permissionLabels = {
  allow: 'com_ui_code_environment_permission_allow',
  ask: 'com_ui_code_environment_permission_ask',
  deny: 'com_ui_code_environment_permission_deny',
} as const;

function effectivePermission(
  field: NonNullable<
    NonNullable<NonNullable<TCodeEnvironmentSummary['configSchema']>['permissions']>['fileWrite']
  >,
  configured: CodeEnvironmentPermissionDecision | undefined,
): CodeEnvironmentPermissionDecision {
  return configured != null && field.allowed.includes(configured) ? configured : field.default;
}

function EnvironmentPermissions({ environment }: { environment: TCodeEnvironmentSummary }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const updateMutation = useUpdateCodeEnvironmentSettingsMutation();
  const idPrefix = useId();
  const fields = environment.configSchema?.permissions;
  if (fields == null || !environment.canEdit) return null;

  const updatePermission = (
    category: 'fileWrite' | 'commandExecution',
    value: CodeEnvironmentPermissionDecision,
  ) => {
    updateMutation.mutate(
      { id: environment.id, settings: { permissions: { [category]: value } } },
      {
        onSuccess: () =>
          showToast({
            message: localize('com_ui_code_environment_permissions_saved'),
            status: 'success',
          }),
        onError: () =>
          showToast({
            message: localize('com_ui_code_environment_permissions_error'),
            status: 'error',
          }),
      },
    );
  };

  const controls = [
    {
      category: 'fileWrite' as const,
      label: 'com_ui_code_environment_file_write' as const,
      field: fields.fileWrite,
    },
    {
      category: 'commandExecution' as const,
      label: 'com_ui_code_environment_command_execution' as const,
      field: fields.commandExecution,
    },
  ].filter((control) => control.field != null);

  return (
    <div className="border-border-light mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
      {controls.map(({ category, label, field }) => {
        if (field == null) return null;
        const value = effectivePermission(field, environment.settings?.permissions?.[category]);
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div id={`${idPrefix}-${category}`} className="text-text-primary text-sm font-medium">
              {localize(label)}
            </div>
            <Dropdown
              value={value}
              options={field.allowed.map((decision) => ({
                value: decision,
                label: localize(permissionLabels[decision]),
              }))}
              disabled={updateMutation.isLoading}
              onChange={(decision) =>
                updatePermission(category, decision as CodeEnvironmentPermissionDecision)
              }
              aria-labelledby={`${idPrefix}-${category}`}
              testId={`code-environment-${category}`}
              variant="field"
              sizeClasses="z-50 min-w-48"
            />
          </div>
        );
      })}
    </div>
  );
}

function EnvironmentCard({
  environment,
  deleting,
  onDelete,
}: {
  environment: TCodeEnvironmentSummary;
  deleting: boolean;
  onDelete: () => Promise<boolean>;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<
    'offline' | 'starting' | 'ready' | 'unavailable' | 'checking'
  >('checking');
  const showReconnect = status === 'offline' || status === 'unavailable';

  return (
    <div className="border-border-medium rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-text-primary truncate text-sm font-medium">{environment.name}</p>
          <p className="text-text-secondary truncate text-xs">{environment.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EnvironmentStatus environmentId={environment.id} onStatus={setStatus} />
          {environment.canDelete && (
            <OGDialog open={open} onOpenChange={setOpen}>
              <OGDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleting}
                  aria-label={localize('com_ui_delete_var', { 0: environment.name })}
                >
                  {localize('com_ui_delete')}
                </Button>
              </OGDialogTrigger>
              <OGDialogTemplate
                className="max-w-md"
                showCloseButton={false}
                title={localize('com_ui_code_environment_remove_title')}
                main={
                  <p className="text-text-secondary text-sm">
                    {localize('com_ui_code_environment_remove_description')}
                  </p>
                }
                cancelDisabled={deleting}
                selection={
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleting}
                    aria-busy={deleting}
                    onClick={async () => {
                      if (await onDelete()) {
                        setOpen(false);
                      }
                    }}
                  >
                    {deleting ? <Spinner /> : localize('com_ui_delete')}
                  </Button>
                }
              />
            </OGDialog>
          )}
        </div>
      </div>
      {showReconnect && <OfflineReconnect workerId={environment.id} />}
      <EnvironmentPermissions environment={environment} />
    </div>
  );
}

export default function CodeEnvironments() {
  const localize = useLocalize();
  const nameId = useId();
  const planeId = useId();
  const { showToast } = useToastContext();
  const query = useCodeEnvironmentsQuery();
  const pairMutation = usePairCodeEnvironmentMutation();
  const deleteMutation = useDeleteCodeEnvironmentMutation();
  const [name, setName] = useState('');
  const [controlPlaneId, setControlPlaneId] = useState('');
  const [pairing, setPairing] = useState<CodeEnvironmentPairingResponse['pairing']>();
  const controlPlanes = query.data?.controlPlanes ?? [];
  const selectedControlPlane = controlPlaneId || controlPlanes[0]?.id || '';

  useEffect(() => {
    if (pairing == null) return;
    const remaining = Date.parse(pairing.expiresAt) - Date.now();
    const delay = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const timeout = window.setTimeout(() => setPairing(undefined), delay);
    return () => window.clearTimeout(timeout);
  }, [pairing]);

  const pair = () => {
    const trimmedName = name.trim();
    if (!trimmedName || !selectedControlPlane) return;
    pairMutation.mutate(
      { name: trimmedName, controlPlaneId: selectedControlPlane },
      {
        onSuccess: (result) => {
          setName('');
          setPairing(result.pairing);
          showToast({
            message: localize('com_ui_code_environment_pairing_created'),
            status: 'success',
          });
        },
        onError: () =>
          showToast({
            message: localize('com_ui_code_environment_pairing_error'),
            status: 'error',
          }),
      },
    );
  };

  const environments = query.data?.environments ?? [];
  /** Pairing and VM-worker copy are for self-service attached machines. When the
   *  deployment has neither control planes nor any machine for this user, hide
   *  the whole row — operator/bridge docs do not belong in Settings. */
  if (
    !query.isLoading &&
    !query.isError &&
    controlPlanes.length === 0 &&
    environments.length === 0
  ) {
    return null;
  }

  let pairingControls: ReactNode = null;
  if (query.isLoading) {
    pairingControls = (
      <div className="text-text-secondary flex items-center gap-2 text-sm">
        <Spinner />
        {localize('com_ui_loading')}
      </div>
    );
  } else if (query.isError) {
    pairingControls = (
      <p className="text-text-destructive text-sm">
        {localize('com_ui_code_environment_load_error')}
      </p>
    );
  } else if (controlPlanes.length > 0) {
    pairingControls = (
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          pair();
        }}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={nameId}>{localize('com_ui_name')}</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={100}
            placeholder={localize('com_ui_code_environment_name_placeholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div id={planeId} className="text-text-primary text-sm font-medium">
            {localize('com_ui_code_environment_control_plane')}
          </div>
          <Dropdown
            value={selectedControlPlane}
            options={controlPlanes.map((controlPlane) => ({
              value: controlPlane.id,
              label: controlPlane.name,
            }))}
            onChange={setControlPlaneId}
            aria-labelledby={planeId}
            testId="code-environment-control-plane"
            variant="field"
            sizeClasses="z-50 min-w-48"
          />
        </div>
        <Button type="submit" disabled={!name.trim() || pairMutation.isLoading}>
          {pairMutation.isLoading ? <Spinner /> : localize('com_ui_code_environment_pair')}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <h3 className="text-text-primary text-sm font-medium">
          {localize('com_ui_code_environments')}
        </h3>
        {controlPlanes.length > 0 && (
          <p className="text-text-secondary mt-1 text-xs">
            {localize('com_ui_code_environments_description')}
          </p>
        )}
      </div>

      {controlPlanes.length > 0 && <InstallGuide />}

      {pairingControls}

      {pairing != null && <WorkerCommand pairing={pairing} />}

      <div className="flex flex-col gap-2">
        {(query.data?.environments ?? []).map((environment) => (
          <EnvironmentCard
            key={environment.id}
            environment={environment}
            deleting={deleteMutation.isLoading}
            onDelete={async () => {
              try {
                await deleteMutation.mutateAsync(environment.id);
                showToast({
                  message: localize('com_ui_code_environment_removed'),
                  status: 'success',
                });
                return true;
              } catch (error) {
                showToast({
                  message: localize(
                    getResponseStatus(error) === 409
                      ? 'com_ui_code_environment_remove_in_use'
                      : 'com_ui_code_environment_remove_error',
                  ),
                  status: 'error',
                });
                return false;
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
