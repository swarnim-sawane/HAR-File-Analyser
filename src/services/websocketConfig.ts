export type SocketTransport = 'polling' | 'websocket';

export function parseSocketTransports(value?: string): SocketTransport[] {
  const parsed = (value || '')
    .split(',')
    .map((transport) => transport.trim().toLowerCase())
    .filter((transport): transport is SocketTransport => transport === 'polling' || transport === 'websocket');

  return parsed.length > 0 ? Array.from(new Set(parsed)) : ['websocket', 'polling'];
}
export function resolveSocketPath(pathname: string): string {
  const marker = '/actions/invoke';
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) return '/socket.io';
  return `${pathname.slice(0, markerIndex + marker.length)}/socket.io`;
}
