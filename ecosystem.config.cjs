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
      exec_mode: 'cluster',
      node_args: '--max-old-space-size=2048',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
      },
    },
    // ─── Worker (fork mode — 2 processes, each with concurrency 4) ───────────
    // Run 2 separate worker processes to utilise more cores.
    // Do NOT use cluster mode for workers — BullMQ workers must not share the
    // Redis connection across forked processes.
    {
      name: 'har-worker',
      script: 'dist/worker.js',
      instances: 2,
      exec_mode: 'fork',
      // --expose-gc lets the code call global.gc() to reclaim memory after
      // large batch inserts; --max-old-space-size prevents OOM on big files.
      node_args: '--max-old-space-size=4096 --expose-gc',
      env: {
        NODE_ENV: 'production',
        // Each worker process handles 4 concurrent jobs → 2 processes = 8 total
        WORKER_CONCURRENCY: '4',
      },
    },
    // ─── Frontend static file server ─────────────────────────────────────────
    {
      name: 'har-frontend',
      script: 'node_modules/.bin/serve',
      args: '-s dist -l 3000',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
