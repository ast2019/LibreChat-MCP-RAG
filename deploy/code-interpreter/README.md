# Code Interpreter (HiveGPT)

The microVM sandbox (`codeapi`, `code_worker`, `code_sandbox`) is **not** deployed on
the Coolify host. It needs `/dev/kvm`, and that device is not granted on the server
that holds the database.

Coding uses the Attached VM bridge in the root `docker-compose.yml`: saas config
keeps `interface.runCode` and the `execute_code` / `stateful_code_sessions`
capabilities on so agents can reach a paired worker. See
`docs/saas/ATTACHED_VM.md`.

## Coolify

1. Leave `LIBRECHAT_CODE_BASEURL` empty. Do not point it at `http://codeapi:3112/v1`.
2. Give a domain only to `codeapi_bridge`. On this host Arvan terminates TLS, so the
   Coolify field is `http://code.aichat.hivelink.co:3114`. The public URL clients and
   the VM use stays `https://code.aichat.hivelink.co/v1`.
3. Leave `code_jwt`, `codeminio`, `code_file`, `code_tools`, `code_egress` and
   `code_bridge_queue` without a domain. Do not publish port 3114.
4. Optional: pin images with `CODEAPI_IMAGE_TAG=sha-<commit>` instead of `main`.

`code_jwt` writes the Ed25519 key the API signs with. The program is inline in
Compose: Coolify cannot bind-mount a file from the git checkout onto the Docker
host. The bridge mounts only the public half. The storage service is named
`codeminio` (no underscore): Silo rejects a Host header with `_`, and Coolify
often drops Compose network aliases. Do not set `CODEAPI_BRIDGE_LOCAL_MODE=true`
and do not set `CODEAPI_AUTH_PROVIDER=none` on the public bridge.
