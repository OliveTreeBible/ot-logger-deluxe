

import { EmbellishedMessage, EmbellishedMessageDetails } from './EmbellishedMessage'

export class StructuredMessage {
    private _messageParts: EmbellishedMessage[]
    constructor(messageParts: EmbellishedMessageDetails[]) {
        this._messageParts = messageParts.map(part => {
            return new EmbellishedMessage(part)
        })
    }

    partAt(index: number): undefined | EmbellishedMessage {
        return index < this._messageParts.length ? this._messageParts[index] : undefined
    }

    get parts() {
        return this._messageParts
    }

    toString(): string {
        return this._messageParts.reduce((p: string, m: EmbellishedMessage, c: number, n: EmbellishedMessage[]) => {
            return p + ' - ' + m.toString()
        },'')
    }

    static Create(message: string | EmbellishedMessageDetails[]) {
        if(typeof message === 'string')
            return new StructuredMessage([{message}])
        else
            return new StructuredMessage(message)
    }

    static CreateWithErrorPart(message: string , errorPart: any) {
        return new StructuredMessage([{ message: message },{ name: 'Upstream Error', message: `${errorPart}`}])
    }
}