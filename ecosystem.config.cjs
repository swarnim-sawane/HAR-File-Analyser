module.exports = {
  apps: [
    {
      name: 'ollama',
      script: 'ollama',
      args: 'serve',
      env: {
        OLLAMA_HOST: '0.0.0.0:11435',
      },
    },
    // ─── Backend API (cluster mode — one instance per CPU core, max 4) ───────
    {
      name: 'har-backend',
      script: 'dist/server.js',
      instances: 4,
      exec_mo