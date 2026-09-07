// types/client.d.ts
import { EventEmitter } from 'events';
import { ClientConfig } from './common';

export interface TunnelClient extends EventEmitter {
  close(): void;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'serverVersion', listener: (version: string) => void): this;
  on(event: 'command', listener: (data: { command: string; args: Record<string, unknown> }) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export function startClient(config: ClientConfig): TunnelClient;