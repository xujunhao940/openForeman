/// <reference types="vite/client" />

declare module 'virtual:open-source-licenses' {
    export const licenses: {
        name: string
        version: string
        license: string | null
        notices: {file: string; text: string}[]
    }[]
    export const chromiumNotices: string | null
}
