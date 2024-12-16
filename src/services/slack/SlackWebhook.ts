import * as superagent from "superagent";

import { ISlackConfig as IOTSlackConfig } from "../../interfaces/slackConfig.interface";
import { OTLogableMessage } from "../../OTLogableMessage";
import { SlackAlertType } from "../../types/SlackAlertType";
import { SlackBodies } from "./SlackBodies";

export type ErrorCallback = (error: unknown) => {};
export class OTSlackWebhook {
  private _slackIntegrationKeys: IOTSlackConfig;
  private _headerText: string;
  constructor(headerText: string, slackIntegrationKeys: IOTSlackConfig) {
    this._slackIntegrationKeys = slackIntegrationKeys;
    this._headerText = headerText;
  }

  _getAlertTypeKey(type: SlackAlertType): undefined | string {
    switch (type) {
      case SlackAlertType.fatal:
        return this._slackIntegrationKeys.keys.fatalChannelKey;
      case SlackAlertType.error:
        return this._slackIntegrationKeys.keys.errorChannelKey;
      case SlackAlertType.warning:
        return this._slackIntegrationKeys.keys.warningChannelKey;
      case SlackAlertType.info:
        return this._slackIntegrationKeys.keys.infoChannelKey;
      default:
        return undefined;
    }
  }

  async _postAlert(errorBody: string, type: SlackAlertType): Promise<void> {
    const key = this._getAlertTypeKey(type);
    if (key !== undefined) {
      await this._postToSlack(key, errorBody);
    }
  }

  _postToSlack(key: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const slackURL = `https://hooks.slack.com/services/${key}`;
      superagent
        .post(slackURL)
        .send(body)
        .set("Content-Type", "application/json")
        .then(() => {
          resolve();
        })
        .catch((error: unknown) => {
          console.log(`Failed to send alert to Slack: ${error}`);
          reject();
        });
    });
  }

  async postFatal(namedMessages: OTLogableMessage, onError?: ErrorCallback) {
    try {
      await this._postAlert(
        SlackBodies.fatalBody(this._headerText, namedMessages),
        SlackAlertType.fatal
      );
    } catch (error) {
      if (onError) onError(error);
    }
  }

  async postError(namedMessages: OTLogableMessage, onError?: ErrorCallback) {
    try {
      await this._postAlert(
        SlackBodies.errorBody(this._headerText, namedMessages),
        SlackAlertType.error
      );
    } catch (error) {
      if (onError) onError(error);
    }
  }

  async postWarning(namedMessages: OTLogableMessage, onError?: ErrorCallback) {
    try {
      await this._postAlert(
        SlackBodies.warningBody(this._headerText, namedMessages),
        SlackAlertType.warning
      );
    } catch (error) {
      if (onError) onError(error);
    }
  }

  async postInfo(namedMessages: OTLogableMessage, onError?: ErrorCallback) {
    try {
      await this._postAlert(
        SlackBodies.infoBody(this._headerText, namedMessages),
        SlackAlertType.info
      );
    } catch (error) {
      if (onError) onError(error);
    }
  }
}
