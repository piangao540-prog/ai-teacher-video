import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import Stage from './Stage'
import Editor from '../../editor/Editor'
import { router } from '../../router'

const params = new URLSearchParams(location.search)


const el = document.getElementById('app')!


if (params.has('edit')) {
  // 加路由之前的旧地址。留一条，免得哪个书签打开是白页。
  createRoot(el).render(<Editor />)
} else if (params.has('render')) {
  // ★ 出片路径：不经过 Router，和加路由之前逐字一致。
  //   出片要的是逐帧像素一样，多包一层 Provider 就多一份风险。
  createRoot(el).render(<Stage />)
} else {
  createRoot(el).render(<RouterProvider router={router} />)
}
