#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE} HAR ANALYZER - SETUP STARTING${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}[ERROR] Docker is not running!${NC}"
    echo ""
    echo "Please start Docker Desktop and try again."
    echo ""
    exit 1
fi

echo -e "${GREEN}[OK] Docker is running${NC}"
echo ""

# Stop any existing containers
echo -e "${YELLOW}[1/4] Cleaning up old containers...${NC}"
docker-compose down > /dev/null 2>&1
echo -e "${GREEN}[OK] Cleanup complete${NC}"
echo ""

# Build and start containers
echo -e "${YELLOW}[2/4] Building HAR Analyzer...${NC}"
echo "     This may take 3-5 minutes on first run"
docker-compose up -d --build

if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Failed to build containers${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] Build complete${NC}"
echo ""

# Wait for services
echo -e "${YELLOW}[3/4] Starting services...${NC}"
sleep 15
echo -e "${GREEN}[OK] Services started${NC}"
echo ""

# Pull AI model
echo -e "${YELLOW}[4/4] Setting up AI model (llama3.2)...${NC}"
echo "     First time: 1-2GB download (2-5 minutes)"
echo "     Next time: Instant (cached)"
echo ""
docker exec har-analyzer-ollama ollama pull llama3.2:latest

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[OK] AI model ready${NC}"
else
    echo -e "${YELLOW}[WARNING] AI model setup incomplete${NC}"
    echo "         App will work, but AI features may be limited"
fi

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN} HAR ANALYZER IS READY!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo -e "> Open Browser: ${BLUE}http://localhost:3000${NC}"
echo ""
echo "Commands:"
echo "  Stop:    docker-compose down"
echo "  Restart: docker-compose restart"
echo "  Logs:    docker-compose logs -f"
echo ""
