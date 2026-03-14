import { Server as SocketIOServer } from 'socket.io';

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

// ADDED: Emit to all connected clients
export function emitGlobal(event: string, data: any): void {
  if (ioInstance) {
    ioInstance.emit(event, data);
  }
}
