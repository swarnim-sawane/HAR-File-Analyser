import os

# Base directory (adjust if needed)
base_dir = r"C:\Users\ssawane\Documents\Work\HAR LATEST\Deployed build\HAR-File-Analyser"

# Folder and file structure
structure = {
    "backend": {
        "src": [
            "server.ts",
            "worker.ts",
            {"config": ["database.ts"]},
            {"routes": ["uploadRoutes.ts", "harRoutes.ts", "consoleLogRoutes.ts", "aiRoutes.ts"]},
            {"services": ["ollamaPool.ts", "streamingParser.ts", "embeddingService.ts", "vectorService.ts", "cacheService.ts"]},
            {"workers": ["harProcessor.ts", "logProcessor.ts"]},
            {"middleware": ["errorHandler.ts", "resourceMonitor.ts", "sessionManager.ts"]},
            {"utils": ["fileChunker.ts", "memoryManager.ts"]}
        ],
        "": ["package.json", "tsconfig.json"]
    },
    "shared": {
        "types": ["har.ts", "consolelog.ts", "api.ts", "websocket.ts"]
    },
    "scripts": {
        "": ["deploy.sh", "setup-services.sh", "health-check.sh"]
    }
}

def create_structure(base, struct):
    for folder, contents in struct.items():
        folder_path = os.path.join(base, folder)
        os.makedirs(folder_path, exist_ok=True)

        for key, items in contents.items():
            current_path = os.path.join(folder_path, key) if key else folder_path
            os.makedirs(current_path, exist_ok=True)

            for item in items:
                if isinstance(item, str):
                    file_path = os.path.join(current_path, item)
                    if not os.path.exists(file_path):
                        with open(file_path, "w") as f:
                            f.write("")  # empty file
                elif isinstance(item, dict):
                    for subfolder, subitems in item.items():
                        subfolder_path = os.path.join(current_path, subfolder)
                        os.makedirs(subfolder_path, exist_ok=True)
                        for subitem in subitems:
                            file_path = os.path.join(subfolder_path, subitem)
                            if not os.path.exists(file_path):
                                with open(file_path, "w") as f:
                                    f.write("")

# Run the function
create_structure(base_dir, structure)

print("Project structure created successfully!")
