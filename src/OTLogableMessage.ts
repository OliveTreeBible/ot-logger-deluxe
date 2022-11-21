import { IOTMessagePart } from './interfaces/otMessagePart.interface'

export class OTLogableMessage {
  private _messageParts: IOTMessagePart[];
  constructor(messageParts: IOTMessagePart[]) {
    this._messageParts = messageParts;
  }

  partAt(index: number): undefined | IOTMessagePart {
    return index < this._messageParts.length
      ? this._messageParts[index]
      : undefined;
  }

  get parts() {
    return this._messageParts;
  }

  toString(): string {
    return this._messageParts.reduce(
      (prev: string, part: IOTMessagePart) => {
        return prev + " - " + this._partToString(part);
      },
      ""
    );
  }

  partsAsStringArray(): string[] {
    return this._messageParts.map((part) => this._partToString(part));
  }

  _partToString(part: IOTMessagePart) {
    let text =
      part.text.length < 1000 ? part.text : part.text.substring(0, 1000);
    text = text.replaceAll("\\", "\\\\");
    text = text.replaceAll('"', '\\"');
    return `${part.name ? `*${part.name}:* ` : ""}${
      part.code ? "`" : ""
    }${text}${part.code ? "`" : ""}`;
  }

  static Create(message: string | IOTMessagePart[]) {
    if (typeof message === "string")
      return new OTLogableMessage([{ text: message }]);
    else return new OTLogableMessage(message);
  }

  static CreateWithErrorPart(message: string, errorPart: unknown) {
    return new OTLogableMessage([
      { text: message },
      { name: "Upstream Error", text: `${errorPart}` },
    ]);
  }
}
