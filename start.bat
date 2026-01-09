@echo off
cls
color 0A
echo ==========================================
echo  HAR ANALYZER - SETUP STARTING
echo ==========================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    color 0C
    echo [ERROR] Docker is not running!
    echo.
    echo Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo [OK] Docker is running
echo.

REM Stop any existing containers
echo [1/4] Cleaning up old containers...
docker-compose down >nul 2>&1
echo [OK] Cleanup complete
echo.

REM Build and start containers
echo [2/4] Building HAR Analyzer...
echo      This may take 3-5 minutes on first run
docker-compose up -d --build

if errorlevel 1 (
    color 0C
    echo [ERROR] Failed to build containers
    pause
    exit /b 1
)

echo [OK] Build complete
echo.

REM Wait for services
echo [3/4] Starting services...
timeout /t 15 /nobreak >nul
echo [OK] Services started
echo.

REM Pull AI model
echo [4/4] Setting up AI model (llama3.2)...
echo      First time: 1-2GB download (2-5 minutes)
echo      Next time: Instant (cached)
echo.
docker exec har-analyzer-ollama ollama pull llama3.2:latest

if errorlevel 1 (
    color 0E
    echo [WARNING] AI model setup incomplete
    echo          App will work, but AI features may be limited
) else (
    echo [OK] AI model ready
)

echo.
color 0A
echo ==========================================
echo  HAR ANALYZER IS READY!
echo ==========================================
echo.
echo ^> Open Browser: http://localhost:3000
echo.
echo Commands:
echo   Stop:    docker-compose down
echo   Restart: docker-compose restart
echo   Logs:    docker-compose logs -f
echo.
pause
