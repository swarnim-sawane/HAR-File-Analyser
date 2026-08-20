import type { ConnectionOptions } from 'bullmq';

interface BullMqEnvironment extends NodeJS.ProcessEnv {
  BULLMQ_PREFIX?: string;
}

export function getBullMqPrefix(
  env: BullMqEnvironment = process.env,
): string | undefined {
  const prefix = env.BULLMQ_PREFIX?.trim();
  return prefix || undefined;
}

/**
 * OCI Hosted Application managed Cache intentionally restricts the Redis INFO
 * command. BullMQ only uses INFO to validate the server version, while the
 * platform already guarantees a compatible Redis runtime. Skipping that
 * optional check does not bypass the Lua scripting commands required for real
 * queue operations; those remain exercised by readiness and end-to-end tests.
 */
export function buildBullMqConnectionOptions(
  connection: ConnectionOptions,
  env: BullMqEnvironment = process.env,
) {
  const prefix = getBullMqPrefix(env);
  return {
    connection,
    skipVersionCheck: true as const,
    ...(prefix ? { prefix } : {}),
  };
}
