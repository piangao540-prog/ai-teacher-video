import { createRoot } from 'react-dom/client'
import Stage from './Stage'
import Editor from '../../editor/Editor'

const params = new URLSearchParams(location.search)


const el = document.getElementById('app')!


if (params.has('edit')) {
  createRoot(el).render(<Editor />)
} else {
  createRoot(el).render(<Stage />)
  if (!params.has('render')) {
    void import('../../plan-ui/mount').then((m) => m.mountPlanPanel())
  }
}
