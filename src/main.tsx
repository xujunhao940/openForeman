import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import {createMemoryRouter, createRoutesFromElements, Route} from "react-router"
import {RouterProvider} from "react-router/dom"

const router = createMemoryRouter(createRoutesFromElements(
    <>
        <Route path="/" element={<App/>}/>
    </>
))

ReactDOM.createRoot(document.getElementById('root')!).render(
    <RouterProvider router={router}/>
)

// Use contextBridge
window.ipcRenderer?.on?.('main-process-message', (_event, message) => {
    console.log(message)
})
