import { LogLevel } from "typescript-logging";

export interface OTLoggerDeluxeOptions {
  logLevel: string | LogLevel;
  logGroupingPattern: string;
  providerName: string;
}
