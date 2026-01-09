// types/common.d.ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface Headers {
  [key: string]: string;
}

export interface ClientConfig {
  targetUrl: string;
  allowInsicureCerts?: boolean;
  wsUrl: string;
  tunnelId: string;
  tunnelEntryUrl?: string;
  tunnelEntryPort: number;
  headers?: Headers;
  environment?: 'development' | 'production';
  autoReconnect?: boolean;
}

export interface ServerConfig {
  port: number;
  host?: string;
  path?: string;
  tunnelIdHeaderName?: string;
}

export interface ConfigResult {
  targetUrl?: string;
  allowInsicureCerts?: boolean;
  wsUrl?: string;
  tunnelId?: string;
  tunnelEntryUrl?: string;
  tunnelEntryPort?: string;
  headers?: Headers;
  environment?: string;
}