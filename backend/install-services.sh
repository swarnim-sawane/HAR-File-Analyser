#!/bin/bash
set -euo pipefail

echo "Installing HAR Analyzer local VM dependencies..."

sudo apt update
sudo apt upgrade -y

echo "Installing Redis..."
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping

echo "Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT version();"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='har_analyzer'" | grep -q 1; then
  sudo -u postgres createdb har_analyzer
fi

cat <<'EOF'
PostgreSQL and Redis are running.

Create a least-privilege PostgreSQL application role through the approved secret-management process,
grant it access to the har_analyzer database, and set DATABASE_URL in backend/.env. The role used for
initial startup must be allowed to create the application tables and indexes, or migrations must be run
separately by a schema owner.
EOF
