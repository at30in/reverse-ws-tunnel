// types/utils.d.ts
import { LogLevel, ConfigResult } from './common';

export function setLogLevel(level: LogLevel): void;
export function getLogLevel(): LogLevel;
export function loadConfig(customPath?: string): ConfigResult;