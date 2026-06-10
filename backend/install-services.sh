#!/bin/bash
set -euo pipefail

echo "Installing optional HAR Analyzer VM dependencies..."

sudo apt update

cat <<'EOF'

Oracle Database is the required persistence and runtime state service for this branch.
Do not install or configure a non-Oracle document store or separate queue/cache service for this branch.

Set the following values in backend/.env or the process environment:
  ORACLE_DB_USER
  ORACLE_DB_PASSWORD
  ORACLE_DB_CONNECT_STRING
  ORACLE_JSON_TABLE

EOF

if command -v qdrant >/dev/null 2>&1; then
  echo "Qdrant already installed."
else
  echo "Installing optional Qdrant service for embedding experiments..."
  curl -sSL https://get.qdrant.tech | bash
fi

sudo systemctl enable qdrant || true
sudo systemctl start qdrant || true

echo "Optional Qdrant setup complete. Verify Oracle Database separately with the owning DBA/team."
