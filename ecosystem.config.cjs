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
{
  name: 'har-analyzer',
  script: 'npm',
  args: 'run dev -- --host 0.0.0.0 --port 3000',
  cwd: '/refresh/home/Downloads/har-analyzer',
  env: {
    NODE_ENV: 'development',
  },
}
,
  ],
};
