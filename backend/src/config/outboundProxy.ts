import { ProxyAgent, setGlobalDispatcher } from 'undici';

type ProxyEnv = Record<string, string | undefined>;

export function resolveOutboundProxyUrl(env: ProxyEnv = process.env): string | null {
  return (
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    null
  );
}

export function configureOutboundProxy(env: ProxyEnv = process.env): string | null {
  const proxyUrl = resolveOutboundProxyUrl(env);
  if (!proxyUrl) return null;

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  return proxyUrl;
}
