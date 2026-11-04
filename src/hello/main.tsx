import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// 对照你写熟的 Vue：
//
//   Vue:   createApp(App).mount('#app')
//   React: createRoot(元素).render(<App />)
//
// 位置和作用一模一样，差别在返回值：
//   createApp 返回**应用实例**（能 .use(plugin)、能挂全局属性）
//   createRoot  返回**渲染器**（只能 render / unmount，它不持有你的状态）
// React 没有「应用实例」这个概念 —— 状态住在组件里，不在某个全局容器里。

// ★ StrictMode 是开发模式的「严格检查」，它有一个会让新手吓一跳的行为：
//   **故意把组件函数执行两遍**，用来暴露「不该有的副作用」。
//   所以下面 App 里的 console.log 会成对出现 —— 不是 bug，是开发模式专属
//   （生产构建里只执行一遍）。第 5 站讲 useEffect 时它还会再出现一次，
//   那才是它真正要抓的东西。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* <SceneLab /> */}
    <App />
  </StrictMode>,
)
