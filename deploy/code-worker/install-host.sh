#!/usr/bin/env bash
# Prepare an Ubuntu VM/host for HiveGPT Attached Code (@librechat/code).
# Run as a user that will own the worker (or with sudo for apt packages).
set -euo pipefail

WORKSPACES="${CODE_WORKSPACES_ROOT:-/srv/code-workspaces}"
ENV_DIR="${CODE_ENVIRONMENTS_DIR:-/etc/librechat-code/environments}"

if [[ "$(id -u)" -eq 0 ]]; then
  APT=(apt-get)
  INSTALL_USER="${SUDO_USER:-root}"
else
  APT=(sudo apt-get)
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
npm install -g @librechat/code

echo
echo "Host ready for user ${INSTALL_USER}."
echo "Next:"
echo "  1. In HiveGPT: Settings → Data & Privacy → Code execution → Code environments → Connect VM"
echo "  2. Pair with the one-time code (replace URL/code):"
echo "       librechat-code pair \"\$LIBRECHAT_CODE_BRIDGE_BASEURL\" '<one-time-code>'"
echo "  3. Start the worker (see deploy/code-worker/README.md)."
echo "  4. Clone a repo under ${WORKSPACES}/my-app and ask the agent to install & test."
