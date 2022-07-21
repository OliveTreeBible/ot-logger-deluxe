import { LogLevel } from 'typescript-logging'
import { Log4TSProvider, Logger } from 'typescript-logging-log4ts-style'

import { LoggerDeluxeOptions } from './interfaces/loggerDeluxeOptions.interface'
import { ISlackConfig } from './interfaces/slackConfig.interface'
import { SlackWebhook } from './services/slack/SlackWebhook'
import { StructuredMessage } from './StructuredMessage'

export class LoggerDeluxe {
    static log4TSProvider: Log4TSProvider
    private _logger: Logger
    private _slackWebhook: undefined | SlackWebhook
    constructor(loggerOptions: LoggerDeluxeOptions, loggerName: string, slackIntegration: ISlackConfig) {
        if(LoggerDeluxe.log4TSProvider === undefined)
            LoggerDeluxe.log4TSProvider = Log4TSProvider.createProvider(loggerOptions.providerName, {
                level: loggerOptions.logLevel,
                groups: [{
                expression: new RegExp(loggerOptions.logGroupingPattern),
                }]
            });
        this._logger = LoggerDeluxe.log4TSProvider.getLogger(loggerName)
        if(slackIntegration) {
            this._slackWebhook = new SlackWebhook(loggerName, slackIntegration)
        }
    }
    
    async logErrorWithErrorPart(logMessage: string, errorPart: any) {
        await this.logMessageAtLevel(LogLevel.Error, StructuredMessage.CreateWithErrorPart(logMessage, errorPart))
    }
    
    async logError(logMessage: string) {
        await this.logMessageAtLevel(LogLevel.Error, StructuredMessage.Create(logMessage))
    }


    async logMessageAtLevel(logLevel: LogLevel, logMessage: string | StructuredMessage) {
        const structuredMessage = typeof logMessage === 'string' ? StructuredMessage.Create(logMessage) : logMessage
        switch (logLevel) {
            case LogLevel.Trace:
                this._logger.trace(()=> structuredMessage.toString())
                break
            case LogLevel.Debug:
                this._logger.debug(()=> structuredMessage.toString())
                break
            case LogLevel.Info:
                this._logger.info(()=> structuredMessage.toString())
                if(this._slackWebhook) {
                    await this._slackWebhook.postInfo(structuredMessage)
                }
                break
            case LogLevel.Warn:
                this._logger.warn(()=> structuredMessage.toString())
                if(this._slackWebhook) {
                    await this._slackWebhook.postWarning(structuredMessage)
                }
                break
            case LogLevel.Error:
                this._logger.error(()=> structuredMessage.toString())
                if(this._slackWebhook) {
                    await this._slackWebhook.postError(structuredMessage)
                }
                break
            case LogLevel.Fatal:
                this._logger.fatal(()=> structuredMessage.toString())
                if(this._slackWebhook) {
                    await this._slackWebhook.postFatal(structuredMessage)
                }                
                break
        }
    }
}
