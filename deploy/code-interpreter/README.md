# Code Interpreter (HiveGPT)

Sandboxed code execution for LibreChat agents and the **Run Code** button, using the
open-source [LibreChat-AI/code-interpreter](https://github.com/LibreChat-AI/code-interpreter)
service. `codeapi`, `code_worker` and `code_sandbox` are services in the root
`docker-compose.yml`, same as the Attached VM bridge. Coolify drops `include`,
so this directory is only the notes. See `docs/saas/ATTACHED_VM.md`.

## What you get

- Agents can run Python/JS and other supported languages in an isolated microVM
- Users can press **Run Code** on chat code blocks
- Files written in the sandbox come back as downloadable attachments
- Analysis of uploaded CSV/Excel-style data through the code environment

This is **not** an attached Ubuntu VM (no `apt install nmap`, no full Git IDE). That is
the separate Code environments / `@librechat/code` worker path.

## Host requirements

| Need | Why |
|---|---|
| `/dev/kvm` (nested virtualization) | Default sandbox is libkrun microVM |
| Extra RAM (~2–4 GB beyond the app) | Each sandbox guest uses `CODEAPI_SANDBOX_RAM_MIB` (default 2048) |
| No public domain on `codeapi` / `code_*` | `LOCAL_MODE=true` trusts the Docker network only |

On ESXi/Proxmox/cloud VMs, turn **nested virtualization** on for the Coolify host before
deploy. Without `/dev/kvm`, `code_sandbox` will not start and Run Code fails.

## Coolify

1. Redeploy after this change so Coolify creates the new `SERVICE_*` secrets
   (`SERVICE_HEX_64_CODEINTERNAL`, `SERVICE_HEX_64_CODEEGRESS`, `SERVICE_HEX_64_CODEBRIDGE`,
   `SERVICE_PASSWORD_CODEREDIS`, `SERVICE_USER_CODEMINIO`, `SERVICE_PASSWORD_CODEMINIO`).
2. Leave `codeapi` and `code_sandbox` **without** a domain. `codeapi_bridge` is the one exception: `https://code.aichat.hivelink.co:3114`.
3. Confirm `api` has `LIBRECHAT_CODE_BASEURL=http://codeapi:3112/v1` (the compose default).
4. Optional: pin images with `CODEAPI_IMAGE_TAG=sha-<commit>` instead of `main`.

## Check

```bash
docker compose exec api wget -qO- http://codeapi:3112/v1/health
```

In chat, pick a model with code enabled, ask it to run a short Python snippet, or press
**Run Code** on a Python block. A CSV upload plus “summarize this with code” is a good
smoke test.

## Attached VMs

`codeapi_bridge` (port 3114 in-container) is the remote-bridge control plane and is
declared in the root compose so Coolify lists it. Follow
[docs/saas/ATTACHED_VM.md](../../docs/saas/ATTACHED_VM.md). Do not confuse it with
this microVM sandbox.

## Hardening later

For a public multi-tenant threat model, move off `LOCAL_MODE` to LibreChat JWT auth
(`CODEAPI_AUTH_PROVIDER=librechat-jwt` and matching keys on both sides — see
[LibreChat Code Interpreter docs](https://www.librechat.ai/docs/configuration/tools/code_interpreter))
and replace the sample execution-manifest keypair. Keep egress hardened and never expose
the microVM Code API (`codeapi`) on the internet. The bridge API may be HTTPS-public only
with `CODEAPI_BRIDGE_LOCAL_MODE=false` and proper auth.
