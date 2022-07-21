export interface ISlackConfig {
    keys: ISlackKeys
}
export interface ISlackKeys {
    fatalChannelKey?: string
    errorChannelKey?: string
    warningChannelKey?: string
    infoChannelKey?: string
}