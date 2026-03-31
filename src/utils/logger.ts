/**
 * Centralized Logger Utility
 *
 * Provides a logger factory that creates prefix-tagged loggers.
 * Debug output is gated by config flags (verbose, debugVlm, debugOllama, debugLlm).
 * Info, warn, and error methods always emit.
 */

import { type Config, loadConfig } from '../config.js';

function isDebugEnabled(prefix: string, config: Config): boolean {
  if (config.verbose) {
    return true;
  }

  if (prefix === 'MLX' || prefix === 'VLM') {
    return config.debugVlm;
  }

  if (prefix === 'Ollama') {
    return config.debugOllama;
  }

  // Note: debugLlm also gates DB audit logging in the MLX adapter
  if (prefix === 'LLM') {
    return config.debugLlm;
  }

  return false;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(prefix: string): Logger {
  const tag = `[${prefix}]`;

  return {
    debug(...args: unknown[]): void {
      try {
        const config = loadConfig();
        if (!isDebugEnabled(prefix, config)) return;
      } catch {
        // Config loading failed — skip debug output gracefully
        return;
      }
      console.log(tag, ...args);
    },

    info(...args: unknown[]): void {
      console.log(tag, ...args);
    },

    warn(...args: unknown[]): void {
      console.warn(tag, ...args);
    },

    error(...args: unknown[]): void {
      console.error(tag, ...args);
    },
  };
}
