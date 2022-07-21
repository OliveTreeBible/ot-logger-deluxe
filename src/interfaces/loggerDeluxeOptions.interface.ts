import { LogLevel } from "typescript-logging";

export interface LoggerDeluxeOptions {
  logLevel: LogLevel;
  logGroupingPattern: string;
  providerName: string;
}
