import { LogLevel } from 'typescript-logging'
import { Log4TSProvider, Logger } from 'typescript-logging-log4ts-style'

import { OTLoggerDeluxeOptions } from './interfaces/loggerDeluxeOptions.interface'
import { ISlackConfig } from './interfaces/slackConfig.interface'
import { OTLogableMessage } from './OTLogableMessage'
import { OTSlackWebhook } from './services/slack/SlackWebhook'

export class OTLoggerDeluxe {
  static log4TSProvider: Log4TSProvider;
  private _logger: Logger;
  private _slackWebhook: undefined | OTSlackWebhook;
  constructor(
    loggerOptions: OTLoggerDeluxeOptions,
    loggerName: string,
    slackIntegration: ISlackConfig
  ) {
    if (OTLoggerDeluxe.log4TSProvider === undefined)
      OTLoggerDeluxe.log4TSProvider = Log4TSProvider.createProvider(
        loggerOptions.providerName,
        {
          level:
            typeof loggerOptions.logLevel === "string"
              ? LogLevel.toLogLevel(loggerOptions.logLevel)
              : loggerOptions.logLevel,
          groups: [
            {
              expression: new RegExp(loggerOptions.logGroupingPattern),
            },
          ],
        }
      );
    this._logger = OTLoggerDeluxe.log4TSProvider.getLogger(loggerName);
    if (slackIntegration) {
      this._slackWebhook = new OTSlackWebhook(loggerName, slackIntegration);
    }
  }

  async logErrorWithErrorPart(
    logMessage: string,
    errorPart: unknown,
    postToSlack = true
  ) {
    await this.logMessageAtLevel(
      LogLevel.Error,
      OTLogableMessage.CreateWithErrorPart(logMessage, errorPart),
      postToSlack
    );
  }

  async logError(logMessage: string, postToSlack = true) {
    await this.logMessageAtLevel(
      LogLevel.Error,
      OTLogableMessage.Create(logMessage),
      postToSlack
    );
  }

  async logMessageAtLevel(
    logLevel: LogLevel,
    logMessage: string | OTLogableMessage,
    postToSlack = true
  ) {
    const logableMessage =
      typeof logMessage === "string"
        ? OTLogableMessage.Create(logMessage)
        : logMessage;
    switch (logLevel) {
      case LogLevel.Trace:
        this._logger.trace(() => logableMessage.toString());
        break;
      case LogLevel.Debug:
        this._logger.debug(() => logableMessage.toString());
        break;
      case LogLevel.Info:
        this._logger.info(() => logableMessage.toString());
        if (postToSlack && this._slackWebhook) {
          await this._slackWebhook.postInfo(logableMessage);
        }
        break;
      case LogLevel.Warn:
        this._logger.warn(() => logableMessage.toString());
        if (postToSlack && this._slackWebhook) {
          await this._slackWebhook.postWarning(logableMessage);
        }
        break;
      case LogLevel.Error:
        this._logger.error(() => logableMessage.toString());
        if (postToSlack && this._slackWebhook) {
          await this._slackWebhook.postError(logableMessage);
        }
        break;
      case LogLevel.Fatal:
        this._logger.fatal(() => logableMessage.toString());
        if (postToSlack && this._slackWebhook) {
          await this._slackWebhook.postFatal(logableMessage);
        }
        break;
    }
  }
}
