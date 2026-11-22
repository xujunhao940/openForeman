export type SleepMode = 'screen-on' | 'screen-off' | 'lid-closed' | 'off'

export interface PowerAPI {
    supported(): Promise<boolean>
    setMode(mode: SleepMode): Promise<void>
}
