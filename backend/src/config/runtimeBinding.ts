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
  const explicitPort = env[explicitPortVariable];
  const platformPort = hosted || explicitPortVariable === 'PORT' ? env.PORT : undefined;
  const rawPort = explicitPort || platformPort || String(hosted ? 8080 : localDefaultPort);
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${explicitPortVariable}: ${rawPort}`);
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port,
  };
}
