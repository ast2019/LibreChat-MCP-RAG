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
2. In Coolify, give **`codeapi_bridge` only** `https://code.aichat.hivelink.co:3114`. The `:3114` is the container port. The CDN forwards to port 80 of the Coolify server. Leave `codeapi` / `code_sandbox` without a public domain.
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

## 3. Pair

In HiveGPT (user with Run Code / code-environment access):

**Settings → Data & Privacy → Code execution → Code environments → Connect VM**

On the VM, redeem the one-time code:

```bash
librechat-code pair "https://code.example.com/v1" '<one-time-code>'
```

## 4. Run the worker

Foreground smoke test:

```bash
librechat-code start --environment /etc/librechat-code/environments/primary.yaml
```

Production: run under systemd as the same OS user that paired (see upstream
[worker runbook](https://github.com/LibreChat-AI/code-interpreter/blob/main/docs/remote-bridge/worker-runbook.md)).

## 5. Use it like a cloud IDE agent

1. In Agent Builder, enable **Stateful code sessions** and pick the attached environment.
2. On the VM: `git clone <repo> /srv/code-workspaces/my-app`
3. In chat (approval mode **Ask** at first): ask the agent to install dependencies, run tests,
   fix failures, and open a PR if GitHub CLI/credentials exist on the VM.

Git identity for commits can be set per agent in LibreChat; repository tokens stay on the VM.
