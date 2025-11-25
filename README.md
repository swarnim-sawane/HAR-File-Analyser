
# 🚀 HAR Analyzer - Quick Start Guide

Network analysis tool with AI-powered insights.

## 📋 Prerequisites

**Install Docker Desktop:**
- Windows/Mac: Download from [docker.com](https://www.docker.com/products/docker-desktop/)
- After installation, **start Docker Desktop**

## 🎯 Quick Start

### Windows Users
1. **Make sure Docker Desktop is running** (check system tray)
2. **Double-click** `start.bat`
3. Wait 2-5 minutes for first-time setup
4. Open **http://localhost:3000** in your browser

### Mac/Linux Users
1. Open Terminal in this folder
2. Run:
   ```
   chmod +x start.sh
   ./start.sh
   ```
3. Open **http://localhost:3000** in your browser

## 📖 Daily Usage

### Starting the Application
```
docker-compose up -d
```

### Stopping the Application
```
docker-compose down
```

### View Logs (if something goes wrong)
```
docker-compose logs -f
```

## ✨ Features

- 📊 HAR File Analysis
- 🎨 Request Visualization
- 🔒 HAR File Sanitizer (Remove sensitive data)
- 🤖 AI Assistant (Powered by Llama 3.2)

## 🆘 Troubleshooting

### "Port 3000 is already in use"
```
docker-compose down
# Wait 5 seconds
docker-compose up -d
```

### "AI is not responding"
```
docker exec har-analyzer-ollama ollama pull llama3.2:latest
```

### "Cannot connect to Docker"
- Make sure Docker Desktop is running
- Restart Docker Desktop
- Try again

### Start Fresh (Reset Everything)
```
docker-compose down -v
docker-compose up -d --build
```

## 📝 System Requirements

- **RAM:** 8GB minimum (16GB recommended for AI features)
- **Disk:** 5GB free space (for Docker + AI model)
- **OS:** Windows 10+, macOS 10.15+, or Linux

## 🔄 Updating

When a new version is released:
```
docker-compose down
docker-compose pull
docker-compose up -d --build
```

## 💡 Tips

- First startup takes 2-5 minutes (downloads AI model)
- Subsequent startups take 10-30 seconds
- Keep Docker Desktop running while using the app
- AI features require ~2GB RAM

## 📞 Support

If you encounter issues:
1. Check Docker Desktop is running
2. Run `docker-compose logs -f` to see errors
3. Try the "Start Fresh" command above
