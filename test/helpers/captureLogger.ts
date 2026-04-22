import { pino } from "pino";

import { Logger } from "../../src/Logger.js";
import type { LoggerOptions } from "../../src/types.js";

export interface CaptureResult {
  logger: Logger;
  records: Array<Record<string, unknown>>;
}

/**
 * Build a Logger that writes pino records into an in-memory array.
 * Useful for asserting on emitted fields without going through stdout.
 */
export function createCapturingLogger(options: LoggerOptions): CaptureResult {
  const records: Array<Record<string, unknown>> = [];

  const stream = {
    write(chunk: string) {
      const trimmed = chunk.trim();
      if (trimmed.length === 0) return;
      for (const line of trimmed.split("\n")) {
        records.push(JSON.parse(line));
      }
    },
  };

  const pinoInstance = pino(
    {
      level: options.level ?? "trace",
      base: {
        ...(options.bindings ?? {}),
        name: options.name,
        hostname: options.hostname ?? "test-host",
        pid: process.pid,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label, num) {
          return { level: num, levelLabel: label };
        },
      },
    },
    stream
  );

  const logger = new Logger(options, pinoInstance);
  return { logger, records };
}
