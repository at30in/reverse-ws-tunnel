// types/server.d.ts
import { ServerConfig } from './common';

export function startWebSocketServer(config: ServerConfig): void;
export function stopWebSocketServer(port: number): Promise<void>;
export function sendCommand(wsPort: number, tunnelId: string, command: string, args?: Record<string, unknown>): boolean;
export function setLogContext(context: string): void;