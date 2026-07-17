export interface RuntimeBinding {
  host: string;
  port: number;
}

export function getRuntimeBinding(
  env: NodeJS.ProcessEnv = process.env,
  localDefaultPort = 4000,
  explicitPortVariable = 'PORT',
): RuntimeBinding {
  const hosted = env.HOSTED_DEPLOYMENT === 'true';
  if (hosted) {
    if (env.HOST?.trim() && env.HOST.trim() !== '0.0.0.0') {
      throw new Error('Hosted Deployment requires HOST=0.0.0.0.');
    }
    const conflictingPort = env[explicitPortVariable]?.trim() || env.PORT?.trim();
    if (conflictingPort && conflictingPort !== '8080') {
      throw new Error('Hosted Deployment requires port 8080.');
    }
    return { host: '0.0.0.0', port: 8080 };
  }
  const explicitPort = env[explicitPortVariable];
  const platformPort = explicitPortVariable === 'PORT' ? env.PORT : undefined;
  const rawPort = explicitPort || platformPort || String(localDefaultPort);
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${explicitPortVariable}: ${rawPort}`);
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port,
  };
}
