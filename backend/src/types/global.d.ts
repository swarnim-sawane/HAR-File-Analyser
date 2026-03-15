import { Server as SocketIOServer } from 'socket.io';

declare global {
  namespace NodeJS {
    interface Global {
      io?: SocketIOServer;
    }
  }
  
  var io: SocketIOServer | undefined;
  var gc: (() => void) | undefined;
}

export {};
