#!/usr/bin/env bash
# Prepare an Ubuntu VM/host for HiveGPT Attached Code (@librechat/code).
# Run as a user that will own the worker (or with sudo for apt packages).
set -euo pipefail

WORKSPACES="${CODE_WORKSPACES_ROOT:-/srv/code-workspaces}"
ENV_DIR="${CODE_ENVIRONMENTS_DIR:-/etc/librechat-code/environments}"
CODE_SRC="${LIBRECHAT_CODE_SRC:-/opt/librechat-code/source}"
USERNS_SYSCTL_KEY=kernel.apparmor_restrict_unprivileged_userns
USERNS_SYSCTL_FILE=/etc/sysctl.d/99-librechat-code-userns.conf

if [[ "$(id -u)" -eq 0 ]]; then
  APT=(apt-get)
  SYSCTL=(sysctl)
  TEE=(tee)
  INSTALL_USER="${SUDO_USER:-root}"
else
  APT=(sudo apt-get)
  SYSCTL=(sudo sysctl)
  TEE=(sudo tee)
  INSTALL_USER="$(id -un)"
fi

echo "==> System packages (Git, bubblewrap, ripgrep, …)"
"${APT[@]}" update
"${APT[@]}" install -y --no-install-recommends \
  bash \
  bubblewrap \
  ca-certificates \
  curl \
  git \
  jq \
  ripgrep \
  socat

if ! command -v node >/dev/null 2>&1; then
  echo "==> Node.js 22.x"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  "${APT[@]}" install -y nodejs
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "Node.js 22+ is required (found $(node -v))" >&2
  exit 1
fi

#
# Anthropic Sandbox Runtime (used by librechat-code for every shell command) runs
# bubblewrap + apply-seccomp. apply-seccomp creates a nested user namespace and
# writes /proc/self/setgroups. Ubuntu 24.04+ sets
# kernel.apparmor_restrict_unprivileged_userns=1 by default, which strips
# capabilities from that namespace, so every command fails with:
#   apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted…)
# Pairing still succeeds; only sandboxed execution breaks.
#
echo "==> User namespaces for bubblewrap / Sandbox Runtime"
if [[ -r "/proc/sys/${USERNS_SYSCTL_KEY//./\/}" ]]; then
  current="$(cat "/proc/sys/${USERNS_SYSCTL_KEY//./\/}")"
  if [[ "${current}" != "0" ]]; then
    echo "    ${USERNS_SYSCTL_KEY}=${current} → 0 (Ubuntu 24.04+ AppArmor default breaks SRT)"
    "${SYSCTL[@]}" -w "${USERNS_SYSCTL_KEY}=0"
    printf '%s=0\n' "${USERNS_SYSCTL_KEY}" | "${TEE[@]}" "${USERNS_SYSCTL_FILE}" >/dev/null
  else
    echo "    ${USERNS_SYSCTL_KEY} already 0"
  fi
else
  echo "    ${USERNS_SYSCTL_KEY} not present on this kernel; skipping"
fi

echo "==> Probing bubblewrap user namespaces"
if ! bwrap --unshare-user --uid "$(id -u)" --gid "$(id -g)" \
  --ro-bind / / --proc /proc --dev /dev \
  /bin/true; then
  cat >&2 <<'EOF'
bubblewrap could not create a capability-bearing user namespace.
librechat-code will fail every shell command with apply-seccomp / setgroups errors.

On Ubuntu 24.04+:
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
  echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-librechat-code-userns.conf

If this host is a container (Docker/LXC) rather than a real VM, nested userns
must be allowed by the outer runtime (CAP_SYS_ADMIN / user namespace nesting).
EOF
  exit 1
fi
echo "    bubblewrap userns probe ok"

echo "==> Optional: Docker Engine on the VM host (for projects that use docker compose)"
if [[ "${INSTALL_DOCKER:-0}" == "1" ]] && ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "${INSTALL_USER}" || true
  echo "Log out/in so group docker applies for ${INSTALL_USER}."
fi

echo "==> Workspace layout"
sudo mkdir -p "${WORKSPACES}" "${ENV_DIR}"
sudo chown -R "${INSTALL_USER}:${INSTALL_USER}" "${WORKSPACES}" || true

if [[ ! -f "${ENV_DIR}/primary.yaml" ]]; then
  sudo tee "${ENV_DIR}/primary.yaml" >/dev/null <<EOF
name: primary
root: ${WORKSPACES}
EOF
  sudo chown "${INSTALL_USER}:${INSTALL_USER}" "${ENV_DIR}/primary.yaml" || true
fi

echo "==> @librechat/code CLI"
if npm install -g @librechat/code; then
  echo "Installed @librechat/code from npm."
else
  echo "npm package missing; building from LibreChat-AI/code-interpreter…"
  sudo mkdir -p "$(dirname "${CODE_SRC}")"
  sudo chown "${INSTALL_USER}:${INSTALL_USER}" "$(dirname "${CODE_SRC}")" || true
  if [[ ! -d "${CODE_SRC}/.git" ]]; then
    git clone --depth 1 https://github.com/LibreChat-AI/code-interpreter.git "${CODE_SRC}"
  else
    git -C "${CODE_SRC}" fetch --depth 1 origin main
    git -C "${CODE_SRC}" reset --hard origin/main
  fi
  npm ci --prefix "${CODE_SRC}/packages/code"
  npm run build --prefix "${CODE_SRC}/packages/code"
  sudo npm install -g "${CODE_SRC}/packages/code"
fi

echo
echo "Host ready for user ${INSTALL_USER}."
echo "Next:"
echo "  1. In HiveGPT: Settings → Data & Privacy → Code execution → Code environments → Connect VM"
echo "  2. Pair with the one-time code shown there (librechat-code pair …)"
echo "  3. Start the worker WITH --command-policy-preset trusted-vm"
echo "     (required on Ubuntu: skips apply-seccomp nested userns; Settings/systemd already include it)."
echo "     Example:"
echo "       LIBRECHAT_CODE_WORKER_ID='…' librechat-code run --default-workspace \\"
echo "         --allow-workspace-writes --allow-workspace-commands --command-policy-preset trusted-vm"
echo "  4. Confirm the environment status shows anthropic-srt:trusted-vm, then clone under ${WORKSPACES}/my-app."
