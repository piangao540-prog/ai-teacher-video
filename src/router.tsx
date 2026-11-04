import { createBrowserRouter } from 'react-router'
import AppLayout from './AppLayout'
import Home from './pages/Home'
import Editor from './editor/Editor'
import NotFound from './pages/NotFound'
import RouteError from './pages/RouteError'
import {lazy, Suspense} from 'react'

const Studio = lazy(() => import('./pages/Studio'))

export const router = createBrowserRouter([
    {
        path: '/',
        element: <AppLayout />,
        errorElement: <RouteError/>,
        children: [
            { index: true, element: <Home /> },
            { path: 'editor', element: <Editor /> },
            { path: 'studio', element: <Suspense fallback={null}><Studio /></Suspense>},
            { path: '*', element: <NotFound />},
        ],
    },
])
