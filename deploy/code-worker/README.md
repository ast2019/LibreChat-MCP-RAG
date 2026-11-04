# Attached VM worker (HiveGPT)

Turns a **real Ubuntu VM** into a Cursor/Kiro-style coding machine for HiveGPT agents:
clone Git, install deps (including Docker **on the VM host**), run tests, edit files, and
iterate until the change works.

This is **not** the microVM Code Interpreter (`codeapi`). Pairing uses `codeapi_bridge`
(remote-bridge). See [docs/saas/ATTACHED_VM.md](../../docs/saas/ATTACHED_VM.md).

## What you get

| Capability | On Attached VM |
|---|---|
| `git clone` / commit | Yes (credentials are yours on the VM) |
| `npm` / `pip` / `apt` | Yes |
| Docker Compose for the **project** | Yes if you install Docker on the VM (`INSTALL_DOCKER=1`) |
| Agent edits + shell with approval | Yes (Ask / Accept edits / Full access) |
| Auto-provision VM from a Git URL alone | **No** — you (or ops) create the VM first |

## 1. Prepare HiveGPT

1. Redeploy so `codeapi_bridge` is running. It is a service in the root `docker-compose.yml` (Coolify does not start services that exist only under `include`).
2. In Coolify, give **`codeapi_bridge` only** `http://code.aichat.hivelink.co:3114`. Arvan terminates TLS, so the Coolify field is `http`, matching `http://hivelink.co:80`. The `:3114` is the container port and is not published. Arvan still forwards to port 80 of the Coolify server. Leave `code_jwt` and the other code services without a domain.
3. `LIBRECHAT_CODE_BRIDGE_BASEURL` defaults to `https://code.aichat.hivelink.co/v1`. `CODEAPI_BRIDGE_LOCAL_MODE` defaults to `false` with paired auth. Do not turn local mode on for the public bridge.
4. `personal-workers` in `config/librechat.saas.yaml` is already enabled. Do not mark that pairing control plane `default: true`.

## 2. Prepare the Ubuntu VM

```bash
curl -fsSL https://raw.githubusercontent.com/<your-fork>/main/deploy/code-worker/install-host.sh \
  | bash
# or copy the script onto the VM and:
INSTALL_DOCKER=1 bash install-host.sh
```

Needs Node.js 22+, Git, bubblewrap, ripgrep, socat. Docker is optional for compose-based apps.

Always start the Attached VM worker with `--command-policy-preset trusted-vm`
(the Settings pairing command and systemd unit do). That preset sets
`allowAllUnixSockets: true`, which drops Anthropic SRT's nested `apply-seccomp`
helper — the usual reason every command fails with
`apply-seccomp: … setgroups … CAP_SYS_ADMIN` on Ubuntu while pairing still works.

The install script also clears Ubuntu 24.04+'s
`kernel.apparmor_restrict_unprivileged_userns` restriction and probes `bwrap`,
which matters for the default `restricted` policy and for bubblewrap itself.

Already paired and seeing that error? Restart with `trusted-vm` first:

```bash
LIBRECHAT_CODE_WORKER_ID='<worker-id>' librechat-code run \
  --default-workspace \
  --allow-workspace-writes \
  --allow-workspace-commands \
  --command-policy-preset trusted-vm
# or: sudo systemctl restart librechat-code.service  # if the unit already has trusted-vm

# optional host hardening for Ubuntu 24.04+:
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-librechat-code-userns.conf
```

## 3. Pair

In HiveGPT (user with Run Code / code-environment access):

**Settings → Data & Privacy → Code execution → Code environments → Connect VM**

On the VM, redeem the one-time code:

```bash
librechat-code pair "https://code.example.com/v1" '<one-time-code>'
```

## 4. Run the worker

Foreground smoke test (Attached VM policy):

```bash
LIBRECHAT_CODE_WORKER_ID='<your-worker-id>' librechat-code run \
  --default-workspace \
  --allow-workspace-writes \
  --allow-workspace-commands \
  --command-policy-preset trusted-vm
```

Or with an environment file:

```bash
librechat-code run \
  --environment /etc/librechat-code/environments/primary.yaml \
  --allow-workspace-writes \
  --allow-workspace-commands \
  --command-policy-preset trusted-vm
```

Production: run under systemd as the same OS user that paired. The Settings
install guide already ships a unit with `trusted-vm`. See also upstream
[worker runbook](https://github.com/LibreChat-AI/code-interpreter/blob/main/docs/remote-bridge/worker-runbook.md).

## 5. Use it like a cloud IDE agent

1. In Agent Builder, enable **Stateful code sessions** and pick the attached environment.
2. On the VM: `git clone <repo> /srv/code-workspaces/my-app`
3. In chat (approval mode **Ask** at first): ask the agent to install dependencies, run tests,
   fix failures, and open a PR if GitHub CLI/credentials exist on the VM.

Git identity for commits can be set per agent in LibreChat; repository tokens stay on the VM.
