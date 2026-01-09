// types/server.d.ts
import { ServerConfig } from './common';

export function startWebSocketServer(config: ServerConfig): void;
export function setLogContext(context: string): void;