import { createRoot } from 'react-dom/client'
import Plan from './Plan'

/** 把生成面板挂到 index.html 的 #plan 上。只有非 ?render 的路径会调它。 */
export function mountPlanPanel(): void {
  const el = document.getElementById('plan')
  if (el) createRoot(el).render(<Plan />)
}
