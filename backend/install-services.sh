#!/bin/bash

echo "🚀 Installing HAR Analyzer dependencies on VM..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install Redis
echo "📦 Installing Redis..."
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify Redis
redis-cli ping

# Install MongoDB
echo "📦 Installing MongoDB..."
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod

# Verify MongoDB
mongosh --eval "db.runCommand({ ping: 1 })"

# Install Qdrant
echo "📦 Installing Qdrant..."
curl -sSL https://get.qdrant.tech | bash
sudo systemctl enable qdrant
sudo systemctl start qdrant




