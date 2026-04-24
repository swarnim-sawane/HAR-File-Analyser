import { Server as SocketIOServer } from 'socket.io';
import { getRedis } from '../config/database';

type SocketEventEnvelope = {
  type: string;
  scope?: 'file' | 'global';
  room?: string;
  data: any;
};

let ioInstance: SocketIOServer | null = null;

export function setSocketIOInstance(io: SocketIOServer): void {
  ioInstance = io;
}

export function getSocketIOInstance(): SocketIOServer | null {
  return ioInstance;
}

export function emitToFile(fileId: string, event: string, data: any): void {
  if (ioInstance) {
    ioInstance.to(`file:${fileId}`).emit(event, data);
  }
}

export function emitGlobal(event: string, data: any): void {
  if (ioInstance) {
    ioInstance.emit(event, data);
  }
}

async function publishSocketEnvelope(envelope: SocketEventEnvelope): Promise<void> {
  try {
    const redis = getRedis();
    await redis.publish('socket:events', JSON.stringify(envelope));
  } catch (error) {
    console.error(`Failed to publish socket event "${envelope.type}":`, error);

    // Fall back to local delivery if Redis is unavailable in-process.
    if (envelope.scope === 'file' && envelope.room) {
      const fileId = envelope.data?.fileId;
      if (fileId) emitToFile(fileId, envelope.type, envelope.data);
      return;
    }

    emitGlobal(envelope.type, envelope.data);
  }
}

export async function publishToFile(fileId: string, event: string, data: any): Promise<void> {
  await publishSocketEnvelope({
    type: event,
    scope: 'file',
    room: `file:${fileId}`,
    data: { ...data, fileId },
  });
}

export async function publishGlobal(event: string, data: any): Promise<void> {
  await publishSocketEnvelope({
    type: event,
    scope: 'global',
    data,
  });
}
