import * as moment from "moment";
import * as os from "os";

import { OTLogableMessage } from "../../OTLogableMessage";
import { SlackAlertType } from "../../types/SlackAlertType";

export class SlackBodies {
  static fatalBody(title: string, logableMessage: OTLogableMessage): string {
    return SlackBodies._fillBody(
      SlackBodies.bodyLevel2,
      title,
      logableMessage,
      SlackAlertType.fatal
    );
  }
  static errorBody(title: string, logableMessage: OTLogableMessage): string {
    return SlackBodies._fillBody(
      SlackBodies.bodyLevel2,
      title,
      logableMessage,
      SlackAlertType.error
    );
  }
  static warningBody(title: string, logableMessage: OTLogableMessage): string {
    return SlackBodies._fillBody(
      SlackBodies.bodyLevel1,
      title,
      logableMessage,
      SlackAlertType.warning
    );
  }
  static infoBody(title: string, logableMessage: OTLogableMessage): string {
    return SlackBodies._fillBody(
      SlackBodies.bodyLevel0,
      title,
      logableMessage,
      SlackAlertType.info
    );
  }

  private static _fillBody(
    body: string,
    title: string,
    logableMessage: OTLogableMessage,
    alertType: SlackAlertType
  ): string {
    const messages = logableMessage
      .partsAsStringArray()
      .reduce((p: string, text: string) => {
        return (
          (p.length > 0 ? p + "," : "") +
          `
            {
                "type": "mrkdwn",
                "text": "${text}"
            }`
        );
      }, "");
    return body
      .replaceAll(SlackBodies.TITLE_STRING, title)
      .replaceAll(SlackBodies.MESSAGE_FIELDS, messages)
      .replaceAll(
        SlackBodies.ALERT_TYPE_STRING,
        SlackBodies._getAlertTypeString(alertType, false)
      )
      .replaceAll(
        SlackBodies.ALERT_TYPE_ICON,
        SlackBodies._getAlertTypeString(alertType, true)
      )
      .replaceAll(
        SlackBodies.TIMESTAMP_STRING,
        moment().format("YYYY-MM-DD HH:mm:ss")
      )
      .replaceAll(SlackBodies.HOSTNAME_STRING, os.hostname());
  }

  private static _getAlertTypeString(
    type: SlackAlertType,
    iconOnly: boolean
  ): string {
    let alertString: string;
    switch (type) {
      case SlackAlertType.fatal:
        alertString = "☠️ `Fatal`";
        break;
      case SlackAlertType.error:
        alertString = "🔥 `Error`";
        break;
      case SlackAlertType.warning:
        alertString = "⚠️ `Warning`";
        break;
      case SlackAlertType.info:
        alertString = "ℹ️ `Info`";
        break;
      default:
        alertString = "🤷 `Unknown`";
    }
    if (iconOnly) {
      return alertString.split(" ")[0];
    } else {
      return alertString;
    }
  }

  private static TITLE_STRING: string = "${SlackBodies.TITLE_STRING}";
  private static ALERT_TYPE_STRING: string = "${SlackBodies.ALERT_TYPE_STRING}";
  private static ALERT_TYPE_ICON: string = "${SlackBodies.ALERT_TYPE_ICON}";
  private static MESSAGE_FIELDS: string = "${SlackBodies.MESSAGE_FIELDS}";
  private static TIMESTAMP_STRING: string = "${SlackBodies.TIMESTAMP_STRING}";
  private static HOSTNAME_STRING: string = "${SlackBodies.HOSTNAME_STRING}";

  private static bodyLevel2 = `{
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "${SlackBodies.ALERT_TYPE_ICON} ${SlackBodies.TITLE_STRING} ${SlackBodies.ALERT_TYPE_ICON}",
                    "emoji": true
                }
            },
            {
                "type": "section",
                "fields": [
                    ${SlackBodies.MESSAGE_FIELDS}
                ]
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": "🚨 *NOTIFY:* @channel 🚨"
                    }
                ]
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.HOSTNAME_STRING}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.TIMESTAMP_STRING}"
                    }
                ]
            }
        ]
    }`;
  private static bodyLevel1 = `{
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "${SlackBodies.ALERT_TYPE_ICON} ${SlackBodies.TITLE_STRING} ${SlackBodies.ALERT_TYPE_ICON}"
                }
            },
            {
                "type": "section",
                "fields": [
                    ${SlackBodies.MESSAGE_FIELDS}
                ]
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.HOSTNAME_STRING}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.TIMESTAMP_STRING}"
                    }
                ]
            }
        ], 
        "username": "NodeAlert"
    }`;

  private static bodyLevel0 = `{
        "blocks": [
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.ALERT_TYPE_ICON} *${SlackBodies.TITLE_STRING}*"
                    },
                    ${SlackBodies.MESSAGE_FIELDS}
                ]
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.HOSTNAME_STRING}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": "${SlackBodies.TIMESTAMP_STRING}"
                    }
                ]
            }
        ], 
        "username": "NodeAlert"
    }`;
}
