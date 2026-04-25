#!/usr/bin/env bash
# OpenSurvey – Server Setup & Update Script
#
# Usage:
#   sudo bash deploy/setup.sh setup    # Full initial server setup (interactive)
#   sudo bash deploy/setup.sh update   # Pull latest code, rebuild, restart
#   sudo bash deploy/setup.sh restart  # Restart the survey service
#   sudo bash deploy/setup.sh status   # Show service status + health check
#   sudo bash deploy/setup.sh health   # HTTP health check only
#   sudo bash deploy/setup.sh help     # Show this help

set -euo pipefail
IFS=$'\n\t'

# ── Resolved paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Installation paths
INSTALL_DIR="/opt/survey-server"
VENV_DIR="${INSTALL_DIR}/venv"
BUILD_DIR="${INSTALL_DIR}/frontend-build"
DATA_DIR="/var/data/survey"
NEWSLETTER_DIR="/var/data/newsletter"
KEY_DIR="/etc/survey"
WWW_DIR="/var/www/survey"
SERVICE_FILE="/etc/systemd/system/umfrage-server.service"
CONFIG_FILE="${KEY_DIR}/setup.conf"
APACHE_SITES="/etc/apache2/sites-available"

# System accounts
SERVER_USER="umfrage"
NEWSLETTER_USER="newsletter"

# Backend port (must match systemd unit + Apache proxy)
BACKEND_PORT="8742"

# ── Terminal colours (disabled when not a tty) ─────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m' GRN='\033[0;32m' YLW='\033[1;33m'
  BLU='\033[0;34m' BLD='\033[1m'    RST='\033[0m'
else
  RED='' GRN='' YLW='' BLU='' BLD='' RST=''
fi

# ── Logging helpers ────────────────────────────────────────────────────────────
info()    { echo -e "${BLU}[INFO]${RST}  $*"; }
ok()      { echo -e "${GRN}[ OK ]${RST}  $*"; }
warn()    { echo -e "${YLW}[WARN]${RST}  $*"; }
err()     { echo -e "${RED}[ERR ]${RST}  $*" >&2; }
die()     { err "$*"; exit 1; }
section() { echo -e "\n${BLD}━━  $*  ━━${RST}"; }
banner()  { echo -e "\n${BLD}${BLU}$*${RST}\n"; }

# ── Guard helpers ──────────────────────────────────────────────────────────────
require_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root: sudo bash deploy/setup.sh $*"
}

check_debian() {
  command -v apt-get &>/dev/null \
    || die "This script requires a Debian/Ubuntu system (apt-get not found)."
}

check_python_version() {
  local ver
  ver="$(python3 -c 'import sys; print(sys.version_info[:2])')" 2>/dev/null || true
  python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null \
    || die "Python 3.11+ is required (found: ${ver:-none}). Install via deadsnakes PPA or source."
}

# ── Step: system packages ──────────────────────────────────────────────────────
step_packages() {
  section "System packages"
  local pkgs=(
    apache2
    python3 python3-venv python3-dev
    nodejs npm
    certbot python3-certbot-apache
    curl
  )
  info "apt-get update…"
  apt-get update -qq
  info "Installing: ${pkgs[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${pkgs[@]}"
  ok "System packages ready."
}

# ── Step: users & directories ──────────────────────────────────────────────────
step_users_and_dirs() {
  section "Users & directories"

  if ! id "${SERVER_USER}" &>/dev/null; then
    useradd -r -s /sbin/nologin -d "${INSTALL_DIR}" "${SERVER_USER}"
    ok "Created user: ${SERVER_USER}"
  else
    info "User '${SERVER_USER}' already exists."
  fi

  if ! id "${NEWSLETTER_USER}" &>/dev/null; then
    useradd -r -m -s /bin/bash "${NEWSLETTER_USER}"
    ok "Created user: ${NEWSLETTER_USER}"
  else
    info "User '${NEWSLETTER_USER}' already exists."
  fi

  usermod -aG "${NEWSLETTER_USER}" "${SERVER_USER}"

  mkdir -p \
    "${INSTALL_DIR}" \
    "${DATA_DIR}" \
    "${NEWSLETTER_DIR}" \
    "${KEY_DIR}" \
    "${WWW_DIR}"

  chown "${SERVER_USER}:${SERVER_USER}" "${DATA_DIR}"
  chmod 700 "${DATA_DIR}"
  chattr +a "${DATA_DIR}" 2>/dev/null \
    || warn "chattr +a failed on ${DATA_DIR} (needs ext4; skip in LXC/VMs without support)."

  chown "${NEWSLETTER_USER}:${NEWSLETTER_USER}" "${NEWSLETTER_DIR}"
  chmod 730 "${NEWSLETTER_DIR}"

  chown -R "root:${SERVER_USER}" "${INSTALL_DIR}"
  chmod 750 "${INSTALL_DIR}"

  ok "Users and directories configured."
}

# ── Step: Python venv + server files ──────────────────────────────────────────
step_python() {
  section "Python environment"

  check_python_version

  if [[ ! -d "${VENV_DIR}" ]]; then
    info "Creating virtual environment at ${VENV_DIR}…"
    python3 -m venv "${VENV_DIR}"
  fi

  info "Installing/updating Python dependencies…"
  "${VENV_DIR}/bin/pip" install -q --upgrade pip
  "${VENV_DIR}/bin/pip" install -q -r "${REPO_ROOT}/src/server/requirements.txt"

  info "Deploying server files…"
  cp "${REPO_ROOT}/src/server/server.py"            "${INSTALL_DIR}/server.py"
  cp "${REPO_ROOT}/src/server/aggregator.py"         "${INSTALL_DIR}/aggregator.py"
  cp "${REPO_ROOT}/src/survey/umfrage_struktur.json" "${INSTALL_DIR}/umfrage_struktur.json"
  chown "root:${SERVER_USER}" \
    "${INSTALL_DIR}/server.py" \
    "${INSTALL_DIR}/aggregator.py" \
    "${INSTALL_DIR}/umfrage_struktur.json"
  chmod 440 \
    "${INSTALL_DIR}/server.py" \
    "${INSTALL_DIR}/aggregator.py" \
    "${INSTALL_DIR}/umfrage_struktur.json"

  ok "Python environment ready."
}

# ── Step: newsletter RSA keypair (one-time) ────────────────────────────────────
step_newsletter_keys() {
  section "Newsletter keypair"

  if [[ -f "${KEY_DIR}/newsletter_pub.pem" ]]; then
    info "Public key already exists at ${KEY_DIR}/newsletter_pub.pem — skipping generation."
    return
  fi

  local keygen="/home/${NEWSLETTER_USER}/newsletter_keygen.py"
  cp "${REPO_ROOT}/src/server/newsletter_keygen.py" "${keygen}"
  chown "${NEWSLETTER_USER}:${NEWSLETTER_USER}" "${keygen}"
  chmod 700 "${keygen}"

  info "Generating RSA-4096 keypair as user '${NEWSLETTER_USER}'…"
  sudo -u "${NEWSLETTER_USER}" python3 "${keygen}"

  # Deploy decrypt utility
  local decrypt="/home/${NEWSLETTER_USER}/newsletter_decrypt.py"
  cp "${REPO_ROOT}/src/server/newsletter_decrypt.py" "${decrypt}"
  chown "${NEWSLETTER_USER}:${NEWSLETTER_USER}" "${decrypt}"
  chmod 700 "${decrypt}"

  ok "Newsletter keypair generated."
  info "  Private key : /home/${NEWSLETTER_USER}/private/newsletter_priv.pem  (${NEWSLETTER_USER} only)"
  info "  Public key  : ${KEY_DIR}/newsletter_pub.pem"
}

# ── Step: interactive / file-based configuration ───────────────────────────────
step_config() {
  section "Configuration"

  # Load saved values when re-running
  if [[ -f "${CONFIG_FILE}" ]]; then
    # shellcheck source=/dev/null
    source "${CONFIG_FILE}"
    info "Loaded existing config from ${CONFIG_FILE}"
  fi

  # Domain
  if [[ -z "${SURVEY_DOMAIN:-}" ]]; then
    read -r -p "  Domain name (e.g. survey.example.com): " SURVEY_DOMAIN
    [[ -n "${SURVEY_DOMAIN}" ]] || die "Domain name is required."
  else
    info "Domain: ${SURVEY_DOMAIN}"
  fi

  # Admin token
  if [[ -z "${ADMIN_TOKEN:-}" ]]; then
    ADMIN_TOKEN="$(python3 -c "import secrets; print(secrets.token_hex(32))")"
    ok "Generated admin token (save this!):"
    echo -e "    ${BLD}${ADMIN_TOKEN}${RST}"
  else
    info "Admin token already set."
  fi

  # FriendlyCaptcha
  if [[ -z "${FRIENDLYCAPTCHA_SITEKEY:-}" ]]; then
    echo ""
    warn "Friendly Captcha keys are required in production."
    warn "Leave empty to run in dev mode (captcha disabled, server logs a warning)."
    read -r -p "  FriendlyCaptcha Sitekey  (public,  from friendlycaptcha.com): " FRIENDLYCAPTCHA_SITEKEY
    read -r -p "  FriendlyCaptcha API Key  (secret,  from friendlycaptcha.com): " FRIENDLYCAPTCHA_API_KEY
    FRIENDLYCAPTCHA_SITEKEY="${FRIENDLYCAPTCHA_SITEKEY:-}"
    FRIENDLYCAPTCHA_API_KEY="${FRIENDLYCAPTCHA_API_KEY:-}"
  else
    info "FriendlyCaptcha already configured."
  fi

  # Admin e-mail (used for certbot)
  if [[ -z "${ADMIN_EMAIL:-}" ]]; then
    read -r -p "  Admin e-mail (for Let's Encrypt notifications): " ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@${SURVEY_DOMAIN}}"
  else
    info "Admin e-mail: ${ADMIN_EMAIL}"
  fi

  # Persist config (chmod 600 — contains secrets)
  mkdir -p "${KEY_DIR}"
  cat > "${CONFIG_FILE}" <<EOF
# OpenSurvey setup configuration — generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# This file contains secrets. Do NOT commit it to version control.
SURVEY_DOMAIN="${SURVEY_DOMAIN}"
ADMIN_EMAIL="${ADMIN_EMAIL}"
ADMIN_TOKEN="${ADMIN_TOKEN}"
FRIENDLYCAPTCHA_SITEKEY="${FRIENDLYCAPTCHA_SITEKEY:-}"
FRIENDLYCAPTCHA_API_KEY="${FRIENDLYCAPTCHA_API_KEY:-}"
EOF
  chmod 600 "${CONFIG_FILE}"
  chown root:root "${CONFIG_FILE}"

  ok "Configuration saved to ${CONFIG_FILE}"
}

# ── Step: systemd service file ─────────────────────────────────────────────────
step_service() {
  section "Systemd service"

  local captcha_env=""
  if [[ -n "${FRIENDLYCAPTCHA_API_KEY:-}" ]]; then
    captcha_env="Environment=FRIENDLYCAPTCHA_API_KEY=${FRIENDLYCAPTCHA_API_KEY}
Environment=FRIENDLYCAPTCHA_SITEKEY=${FRIENDLYCAPTCHA_SITEKEY}"
  fi

  cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Umfrage Survey Server
After=network.target

[Service]
Type=simple
User=${SERVER_USER}
Group=${SERVER_USER}
WorkingDirectory=${INSTALL_DIR}

Environment=SURVEY_DATA_DIR=${DATA_DIR}
Environment=SURVEY_ALLOWED_ORIGINS=*
Environment=NEWSLETTER_DATA_FILE=${NEWSLETTER_DIR}/subscribers.ndjson
Environment=NEWSLETTER_PUB_KEY=${KEY_DIR}/newsletter_pub.pem
Environment=ADMIN_TOKEN=${ADMIN_TOKEN}
${captcha_env}

# --proxy-headers + --forwarded-allow-ips are required so that the real client
# IP is used for rate limiting; without them X-Forwarded-For is spoofable.
# --limit-max-requests recycles the worker after N requests to contain leaks.
ExecStart=${VENV_DIR}/bin/uvicorn server:app \\
    --host 127.0.0.1 \\
    --port ${BACKEND_PORT} \\
    --workers 1 \\
    --proxy-headers \\
    --forwarded-allow-ips 127.0.0.1 \\
    --limit-max-requests 10000

Restart=on-failure
RestartSec=5

# ── Systemd hardening ──────────────────────────────────────────
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=${DATA_DIR} ${NEWSLETTER_DIR}
ProtectHome=yes
PrivateDevices=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
LockPersonality=yes
MemoryDenyWriteExecute=yes
RestrictRealtime=yes
RestrictNamespaces=yes
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable umfrage-server
  ok "Systemd service installed and enabled."
}

# ── Step: Apache vhosts ────────────────────────────────────────────────────────
step_apache() {
  section "Apache"

  a2enmod proxy proxy_http headers ssl rewrite

  # HTTP → HTTPS redirect
  cat > "${APACHE_SITES}/survey.conf" <<EOF
<VirtualHost *:80>
    ServerAdmin ${ADMIN_EMAIL}
    ServerName ${SURVEY_DOMAIN}
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule (.*) https://%{HTTP_HOST}%{REQUEST_URI}
    RewriteCond %{SERVER_NAME} =${SURVEY_DOMAIN}
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>
EOF

  a2ensite survey
  apache2ctl configtest && systemctl reload apache2

  # TLS certificate via certbot
  if [[ ! -d "/etc/letsencrypt/live/${SURVEY_DOMAIN}" ]]; then
    info "Requesting TLS certificate for ${SURVEY_DOMAIN}…"
    certbot certonly --apache \
      -d "${SURVEY_DOMAIN}" \
      --email "${ADMIN_EMAIL}" \
      --agree-tos \
      --non-interactive \
      || die "certbot failed. Check DNS and try manually: certbot certonly --apache -d ${SURVEY_DOMAIN}"
  else
    info "TLS certificate already present for ${SURVEY_DOMAIN}."
  fi

  # HTTPS vhost with proxy, frontend, and hardening
  cat > "${APACHE_SITES}/survey-ssl.conf" <<EOF
<VirtualHost *:443>
    ServerAdmin ${ADMIN_EMAIL}
    ServerName ${SURVEY_DOMAIN}

    DocumentRoot ${WWW_DIR}
    <Directory ${WWW_DIR}>
        Options -Indexes
        AllowOverride None
        Require all granted
        FallbackResource /index.html
    </Directory>

    RewriteEngine On
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"

    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"
    Header always set Referrer-Policy "no-referrer"

    <Location /api/survey>
        ProxyPass        http://127.0.0.1:${BACKEND_PORT}/api/survey
        ProxyPassReverse http://127.0.0.1:${BACKEND_PORT}/api/survey
        <LimitExcept POST OPTIONS>
            Require all denied
        </LimitExcept>
        LimitRequestBody 524288
    </Location>

    <Location /api/newsletter>
        ProxyPass        http://127.0.0.1:${BACKEND_PORT}/api/newsletter
        ProxyPassReverse http://127.0.0.1:${BACKEND_PORT}/api/newsletter
        <LimitExcept POST OPTIONS>
            Require all denied
        </LimitExcept>
        LimitRequestBody 4096
    </Location>

    <Location /health>
        ProxyPass        http://127.0.0.1:${BACKEND_PORT}/health
        ProxyPassReverse http://127.0.0.1:${BACKEND_PORT}/health
        Require ip 127.0.0.1 ::1
    </Location>

    <Location /results>
        ProxyPass        http://127.0.0.1:${BACKEND_PORT}/results
        ProxyPassReverse http://127.0.0.1:${BACKEND_PORT}/results
    </Location>

    # Admin dashboard: localhost + Tailscale CGNAT only
    <Location /admin>
        ProxyPass        http://127.0.0.1:${BACKEND_PORT}/admin
        ProxyPassReverse http://127.0.0.1:${BACKEND_PORT}/admin
        Require ip 127.0.0.1 ::1 100.64.0.0/10
    </Location>

    TraceEnable off
    <Files ".ht*">
        Require all denied
    </Files>

    SSLEngine on
    SSLProtocol             -all +TLSv1.2 +TLSv1.3
    SSLCipherSuite          ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305
    SSLHonorCipherOrder     off
    SSLSessionTickets       off

    SSLCertificateFile    /etc/letsencrypt/live/${SURVEY_DOMAIN}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/${SURVEY_DOMAIN}/privkey.pem

    ErrorLog  \${APACHE_LOG_DIR}/survey-error.log
    CustomLog \${APACHE_LOG_DIR}/survey-access.log combined
</VirtualHost>
EOF

  a2ensite survey-ssl
  apache2ctl configtest && systemctl reload apache2
  ok "Apache configured with TLS."
}

# ── Step: React/Vite frontend build ───────────────────────────────────────────
step_frontend() {
  section "Frontend build"

  command -v npm &>/dev/null || die "npm not found — install Node.js first."

  # One-time: scaffold Vite project
  if [[ ! -d "${BUILD_DIR}/node_modules" ]]; then
    info "Scaffolding Vite React project (first time)…"
    rm -rf "${BUILD_DIR}"
    mkdir -p "${INSTALL_DIR}"

    pushd "${INSTALL_DIR}" > /dev/null
    CI=true npm create vite@latest "$(basename "${BUILD_DIR}")" -- --template react --yes 2>&1 \
      || CI=true npx --yes create-vite@latest "$(basename "${BUILD_DIR}")" --template react
    popd > /dev/null

    pushd "${BUILD_DIR}" > /dev/null
    npm install --silent
    popd > /dev/null
  fi

  # Always ensure FriendlyCaptcha SDK is present (safe to re-run on update)
  pushd "${BUILD_DIR}" > /dev/null
  npm install --silent @friendlycaptcha/sdk
  popd > /dev/null

  info "Copying source files to build directory…"

  # Patch SERVER_URL to match the configured domain
  sed "s|const SERVER_URL = \"https://survey\.muehrke\.de/api/survey\";|const SERVER_URL = \"https://${SURVEY_DOMAIN}/api/survey\";|" \
    "${REPO_ROOT}/src/survey/umfrage.jsx" \
    > "${BUILD_DIR}/src/App.jsx"

  # Replace Vite's default index.css (dark background, body flex centering, #root
  # padding) with a minimal reset so the survey renders full-screen without black
  # edges or offset content.
  cat > "${BUILD_DIR}/src/index.css" <<'CSSEOF'
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: #f8fafc; }
#root { height: 100%; }
CSSEOF

  # Also copy the question schema (may be imported by the JSX in the future)
  cp "${REPO_ROOT}/src/survey/umfrage_struktur.json" \
    "${BUILD_DIR}/public/umfrage_struktur.json"

  info "Running npm build…"
  pushd "${BUILD_DIR}" > /dev/null
  npm run build --silent
  popd > /dev/null

  info "Deploying frontend to ${WWW_DIR}…"
  mkdir -p "${WWW_DIR}"
  cp -r "${BUILD_DIR}/dist/." "${WWW_DIR}/"
  chown -R www-data:www-data "${WWW_DIR}"

  ok "Frontend built and deployed to ${WWW_DIR}."
}

# ── Step: admin + results dashboard pages ─────────────────────────────────────
step_dashboards() {
  section "Dashboard pages"

  mkdir -p "${INSTALL_DIR}/admin" "${INSTALL_DIR}/results"
  cp "${REPO_ROOT}/src/admin/index.html"   "${INSTALL_DIR}/admin/index.html"
  cp "${REPO_ROOT}/src/results/index.html" "${INSTALL_DIR}/results/index.html"
  chown -R "root:${SERVER_USER}" "${INSTALL_DIR}/admin" "${INSTALL_DIR}/results"
  chmod 640 \
    "${INSTALL_DIR}/admin/index.html" \
    "${INSTALL_DIR}/results/index.html"

  ok "Admin and results dashboards deployed."
}

# ── Step: health check (waits up to ~20 s) ────────────────────────────────────
step_health() {
  section "Health check"

  local attempts=0 max=10
  info "Waiting for service to respond on port ${BACKEND_PORT}…"
  while (( attempts < max )); do
    if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" &>/dev/null; then
      ok "Service is healthy at http://127.0.0.1:${BACKEND_PORT}/health"
      return 0
    fi
    (( attempts++ ))
    sleep 2
  done

  warn "Health check did not pass after $((max * 2))s."
  warn "Inspect logs: journalctl -u umfrage-server -n 50 --no-pager"
  return 1
}

# ── Commands ───────────────────────────────────────────────────────────────────

cmd_setup() {
  require_root
  check_debian

  banner "OpenSurvey — Initial Server Setup"
  info "Repo root : ${REPO_ROOT}"
  info "Install   : ${INSTALL_DIR}"

  step_packages
  step_users_and_dirs
  step_python
  step_newsletter_keys
  step_config          # interactive; persists to ${CONFIG_FILE}
  step_service
  step_dashboards
  step_frontend
  step_apache

  section "Starting service"
  systemctl restart umfrage-server
  step_health

  echo ""
  echo -e "${GRN}${BLD}╔══════════════════════════════════════╗${RST}"
  echo -e "${GRN}${BLD}║   Setup complete — OpenSurvey live!  ║${RST}"
  echo -e "${GRN}${BLD}╚══════════════════════════════════════╝${RST}"
  echo ""
  echo -e "  Survey  : ${BLD}https://${SURVEY_DOMAIN}/${RST}"
  echo -e "  Results : https://${SURVEY_DOMAIN}/results"
  echo -e "  Admin   : http://127.0.0.1:${BACKEND_PORT}/admin  (localhost / Tailscale only)"
  echo ""
  echo -e "  Admin token : ${BLD}${ADMIN_TOKEN}${RST}"
  echo -e "  Saved in    : ${CONFIG_FILE}"
  echo ""
}

cmd_update() {
  require_root

  banner "OpenSurvey — Update & Rebuild"

  [[ -f "${CONFIG_FILE}" ]] \
    || die "No config found at ${CONFIG_FILE}. Run 'setup' first."
  # shellcheck source=/dev/null
  source "${CONFIG_FILE}"

  section "Git pull"
  if git -C "${REPO_ROOT}" pull --ff-only 2>&1; then
    ok "Repository updated."
  else
    warn "git pull failed — continuing with existing local files."
  fi

  step_python
  step_dashboards
  step_frontend

  section "Restarting service"
  systemctl restart umfrage-server
  step_health

  ok "Update complete."
}

cmd_restart() {
  require_root

  section "Restarting survey service"
  systemctl restart umfrage-server
  step_health
  ok "Service restarted."
}

cmd_status() {
  echo ""
  echo -e "${BLD}OpenSurvey — Service Status${RST}"
  echo ""
  systemctl status umfrage-server --no-pager -l || true
  echo ""
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" &>/dev/null; then
    ok "HTTP health check: PASS"
  else
    warn "HTTP health check: FAIL (service may be stopped or starting)"
  fi
}

cmd_health() {
  step_health
}

cmd_help() {
  echo ""
  echo -e "${BLD}OpenSurvey Setup Script${RST}"
  echo ""
  echo -e "Usage: ${BLD}sudo bash deploy/setup.sh <command>${RST}"
  echo ""
  echo "Commands:"
  echo "  setup    Full initial server setup (interactive, idempotent)"
  echo "  update   Pull latest code, rebuild frontend, restart service"
  echo "  restart  Restart the umfrage-server systemd service"
  echo "  status   Show service status and run a health check"
  echo "  health   HTTP health check only"
  echo "  help     Show this message"
  echo ""
  echo "Config is stored at: ${CONFIG_FILE}"
  echo ""
}

# ── Dispatch ───────────────────────────────────────────────────────────────────
main() {
  local cmd="${1:-help}"
  shift || true
  case "${cmd}" in
    setup)          cmd_setup   "$@" ;;
    update)         cmd_update  "$@" ;;
    restart)        cmd_restart "$@" ;;
    status)         cmd_status  "$@" ;;
    health)         cmd_health  "$@" ;;
    help|-h|--help) cmd_help        ;;
    *) die "Unknown command '${cmd}'. Run 'sudo bash deploy/setup.sh help'." ;;
  esac
}

main "$@"
