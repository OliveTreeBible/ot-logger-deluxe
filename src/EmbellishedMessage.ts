export class EmbellishedMessage {
    constructor(details: EmbellishedMessageDetails) {
        this._name = details.name
        this._message = details.message
        this._code = details.code ? details.code : false
    }
    private _name: undefined | string
    private _message: string
    private _code: boolean

    get name() {
        return this._name
    }
    get message() {
        return this._message
    }
    get isCode() {
        return this._code
    }

    toString() {
        let message = this.message.length < 1000 ? this.message : this.message.substring(0,1000)
        message = message.replaceAll("\"", "\\\"")
        return `${this.name ? `*${this.name}:* `: ''}${this.isCode ? '`' : ''}${message}${this.isCode ? '`' : ''}`
    }
}

export interface EmbellishedMessageDetails {
    name?: string
    message: string
    code?: boolean
}