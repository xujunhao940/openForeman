import {app, dialog, Menu, nativeImage} from 'electron'
import path from 'node:path'
import type {MenuCommand} from '../shared/menu'

export const macAppName = 'Foreman'

export function installMacMenu(iconDirectory: string, dispatch: (command: MenuCommand) => void) {
    const aboutIcon = nativeImage.createFromPath(path.join(iconDirectory, 'Foreman-mac.png')).resize({width: 128})
    const about = {
        label: `About ${macAppName}`,
        click: () => {
            app.focus({steal: true})
            void dialog.showMessageBox({
                message: macAppName,
                detail: `Version ${app.getVersion()}`,
                icon: aboutIcon,
                buttons: ['OK'],
            })
        },
    }
    const settings = {label: 'Settings…', click: () => dispatch('settings')}
    const plugins = {label: 'Plugins', click: () => dispatch('plugins')}
    const newChat = {label: 'New Chat', click: () => dispatch('new-chat')}
    const addProject = {label: 'Add Project…', click: () => dispatch('add-project')}

    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: macAppName,
            submenu: [
                about,
                {type: 'separator'},
                {...settings, accelerator: 'Cmd+,'},
                plugins,
                {type: 'separator'},
                {role: 'services'},
                {type: 'separator'},
                {label: `Hide ${macAppName}`, role: 'hide'},
                {role: 'hideOthers'},
                {role: 'unhide'},
                {type: 'separator'},
                {label: `Quit ${macAppName}`, role: 'quit'},
            ],
        },
        {
            label: 'File',
            submenu: [
                {...newChat, accelerator: 'Cmd+N'},
                {...addProject, accelerator: 'Cmd+O'},
                {type: 'separator'},
                {role: 'close'},
            ],
        },
        {role: 'editMenu'},
        {
            label: 'View',
            submenu: [
                {role: 'resetZoom'},
                {role: 'zoomIn'},
                {role: 'zoomOut'},
                {type: 'separator'},
                {role: 'togglefullscreen'},
            ],
        },
        {role: 'windowMenu'},
    ]))

}
