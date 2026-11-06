import type { TCodeEnvironmentPairingResponse } from '../types';

export type CodeWorkerShell = 'posix' | 'powershell';
export type CodeWorkerPairing = TCodeEnvironmentPairingResponse['pairing'];

export interface CodeWorkerRunOptions {
  defaultWorkspace?: boolean;
  allowWorkspaceWrites?: boolean;
  allowWorkspaceCommands?: boolean;
  /**
   * Attached VMs should pass `trusted-vm`: the VM boundary is the isolation, and
   * the preset still keeps SRT's credential/socket protection. Omit for the
   * default `restricted` personal-machine policy.
   */
  commandPolicyPreset?: string;
}

export function isCodeWorkerShell(value: string): value is CodeWorkerShell {
  return value === 'posix' || value === 'powershell';
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildCodeWorkerRunCommand(
  workerId: string,
  shell: CodeWorkerShell,
  options: CodeWorkerRunOptions = {},
): string {
  const quote = shell === 'powershell' ? quotePowerShell : quotePosix;
  const preset =
    typeof options.commandPolicyPreset === 'string' && options.commandPolicyPreset.trim() !== ''
      ? options.commandPolicyPreset.trim()
      : null;
  const runArgs = [
    options.defaultWorkspace === false ? null : '--default-workspace',
    options.allowWorkspaceWrites === true ? '--allow-workspace-writes' : null,
    options.allowWorkspaceCommands === true ? '--allow-workspace-commands' : null,
    preset == null ? null : `--command-policy-preset ${quote(preset)}`,
  ].filter((value): value is string => value != null);
  const run = ['librechat-code run', ...runArgs].join(' ');
  if (shell === 'powershell') {
    return `$env:LIBRECHAT_CODE_WORKER_ID = ${quote(workerId)}\n${run}`;
  }
  return `LIBRECHAT_CODE_WORKER_ID=${quote(workerId)} ${run}`;
}

/** One-time pair + first run. Pairing codes expire; the registration itself does not. */
export function createCodeWorkerSetupCommand(
  pairing: CodeWorkerPairing,
  shell: CodeWorkerShell,
  options: CodeWorkerRunOptions = {},
): string {
  const quote = shell === 'powershell' ? quotePowerShell : quotePosix;
  const pair = `librechat-code pair ${quote(pairing.endpoint)} ${quote(pairing.code)} --worker-id ${quote(pairing.workerId)}`;
  return `${pair}\n${buildCodeWorkerRunCommand(pairing.workerId, shell, options)}`;
}

/** Restart an already-paired worker with the same id — no new pairing code. */
export function createCodeWorkerRunCommand(
  workerId: string,
  shell: CodeWorkerShell,
  options: CodeWorkerRunOptions = {},
): string {
  return buildCodeWorkerRunCommand(workerId, shell, options);
}
