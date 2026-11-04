# Code Interpreter (HiveGPT)

The microVM sandbox (`codeapi`, `code_worker`, `code_sandbox`) is **not** deployed on
the Coolify host. It needs `/dev/kvm`, and that device is not granted on the server
that holds the database. `interface.runCode` is off and `execute_code` is not in
`config/librechat.saas.yaml`.

Coding uses the Attached VM bridge in the root `docker-compose.yml`. See
`docs/saas/ATTACHED_VM.md`.

## Coolify

1. Leave `LIBRECHAT_CODE_BASEURL` empty. Do not point it at `http://codeapi:3112/v1`.
2. Give a domain only to `codeapi_bridge`. On this host Arvan terminates TLS, so the
   Coolify field is `http://code.aichat.hivelink.co:3114`. The public URL clients and
   the VM use stays `https://code.aichat.hivelink.co/v1`.
3. Leave `code_jwt`, `code_minio`, `code_file`, `code_tools`, `code_egress` and
   `code_bridge_queue` without a domain. Do not publish port 3114.
4. Optional: pin images with `CODEAPI_IMAGE_TAG=sha-<commit>` instead of `main`.

`code_jwt` writes the Ed25519 key the API signs with. The bridge mounts only the
public half. Do not set `CODEAPI_BRIDGE_LOCAL_MODE=true` and do not set
`CODEAPI_AUTH_PROVIDER=none` on the public bridge.
