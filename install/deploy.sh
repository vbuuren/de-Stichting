#!/usr/bin/env bash
set -euo pipefail
# Ultra-complete deploy script for de-Stichting (designed for Debian/Ubuntu containers)
# - Installs system deps (Node, npm, sqlite3, nginx, git, openssl, locales)
# - Sets locales en_US.UTF-8 + nl_NL.UTF-8
# - Installs backend & frontend dependencies
# - Generates a secure JWT_SECRET and writes /etc/destichting/backend.env
# - Runs Prisma generate + migrate (with fallback to db push) + seed
# - Builds frontend and configures nginx to serve it and proxy /api to backend
# - Creates systemd service destichting-backend.service (runs as www-data)
#
# Usage:
#   sudo bash install/deploy.sh
#
APP_DIR="/opt/destichting"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
UPLOAD_DIR="/var/lib/destichting/uploads"
ENV_DIR="/etc/destichting"
SERVICE_FILE="/etc/systemd/system/destichting-backend.service"
NGINX_SITE="/etc/nginx/sites-available/destichting"

echo "==> Starting deploy at $(date)"
sudo mkdir -p "$APP_DIR" "$UPLOAD_DIR" "$ENV_DIR" /var/www/destichting
sudo chown -R root:root "$APP_DIR" || true
sudo chown -R www-data:www-data "$UPLOAD_DIR" || true
sudo chmod -R 775 "$UPLOAD_DIR" || true

export DEBIAN_FRONTEND=noninteractive
echo "==> Updating apt and installing base packages"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg build-essential nginx sqlite3 git unzip openssl locales

echo "==> Generating locales (en_US.UTF-8 + nl_NL.UTF-8)"
sudo locale-gen en_US.UTF-8 nl_NL.UTF-8 || true
sudo update-locale LANG=en_US.UTF-8

# Install Node.js LTS (20.x recommended)
if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js (LTS)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Node version: $(node -v)"
echo "==> NPM version: $(npm -v)"

# Sync files from current folder to $APP_DIR (assumes you ran this script from repository root)
# echo "==> Syncing repository files to $APP_DIR"
# sudo rsync -a --delete ./ "$APP_DIR/"

# Backend install
echo "==> Installing backend dependencies (including devDeps for Prisma)"
cd "$BACKEND_DIR"
# Use npm ci for reproducible install; will install devDependencies as well (prisma needed)
sudo npm ci

echo "==> Generating Prisma client"
sudo npx prisma generate

echo "==> Applying Prisma migrations (deploy). If none exist, will fallback to db push."
if ! sudo npx prisma migrate deploy --preview-feature; then
  echo "==> migrate deploy failed or not present — running prisma db push as fallback"
  sudo npx prisma db push --accept-data-loss
fi

echo "==> Seeding database (prisma seed)"
# ensure node can execute seed (package.json has "prisma:seed")
sudo npm run prisma:seed || echo "prisma:seed failed; check seed script"

# Frontend build
echo "==> Installing frontend dependencies and building static site"
cd "$FRONTEND_DIR"
sudo npm ci
sudo npm run build
sudo rsync -a "$FRONTEND_DIR/dist/" /var/www/destichting/

# Environment file generation (secure JWT_SECRET)
JWT_SECRET=$(openssl rand -hex 32)
echo "==> Writing environment to $ENV_DIR/backend.env (JWT_SECRET generated)"
sudo bash -c "cat > $ENV_DIR/backend.env" <<EOF
NODE_ENV=production
PORT=4000
DATABASE_URL=\"file:$BACKEND_DIR/prisma/dev.db\"
JWT_SECRET=\"$JWT_SECRET\"
UPLOAD_DIR=\"$UPLOAD_DIR\"
APP_URL=\"http://192.168.1.103\"
EOF

# Systemd service
echo "==> Installing systemd service"
sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=deStichting Backend API
After=network.target

[Service]
Type=simple
EnvironmentFile=$ENV_DIR/backend.env
WorkingDirectory=$BACKEND_DIR
ExecStart=/usr/bin/node $BACKEND_DIR/src/server.js
Restart=always
User=www-data
Group=www-data
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable destichting-backend.service
sudo systemctl restart destichting-backend.service || sudo journalctl -u destichting-backend -n 50 --no-pager

# Nginx config
echo "==> Writing nginx site file and enabling site"
sudo bash -c "cat > $NGINX_SITE" <<'EOF'
server {
  listen 80;
  server_name 192.168.1.103 destichting.ddns.net;

  root /var/www/destichting;
  index index.html;

  # Proxy API requests to backend
  location /api/ {
    proxy_pass http://127.0.0.1:4000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /uploads/ {
    proxy_pass http://127.0.0.1:4000/uploads/;
  }

  location / {
    try_files $uri /index.html;
  }
}
EOF

sudo ln -sf $NGINX_SITE /etc/nginx/sites-enabled/destichting
sudo nginx -t
sudo systemctl restart nginx

echo "==> Fixing permissions: make app readable by www-data (but keep root as owner for updates)"
sudo chown -R root:www-data $APP_DIR || true
sudo chmod -R g+rX $APP_DIR || true
sudo chown -R www-data:www-data $UPLOAD_DIR || true

echo "==> Deploy finished at $(date)"
echo "Visit: http://192.168.1.103 or http://destichting.ddns.net"
echo "JWT_SECRET generated and stored in $ENV_DIR/backend.env"
