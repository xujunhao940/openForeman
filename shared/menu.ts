export type MenuCommand = 'settings' | 'plugins' | 'add-project' | 'new-chat'

export interface MenuAPI {
    subscribe(listener: (command: MenuCommand) => void): () => void
}
