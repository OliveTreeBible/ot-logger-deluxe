import { LogLevel } from 'typescript-logging'

export interface LoggerDeluxeOptions {
  logLevel: string | LogLevel;
  logGroupingPattern: string;
  providerName: string;
}
