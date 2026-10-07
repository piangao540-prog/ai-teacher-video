import { createApp } from 'vue'
import Stage from './Stage.vue'

const params = new URLSearchParams(location.search)

// 播放器照旧挂载 —— 这一支的 DOM 一个字都没动过。
createApp(Stage).mount('#app')

// ★ `?render=1` 是**出片路径**（frames.ts / shot.ts 走它），那里的每一帧
//   都拿去做逐帧对拍：面板代码在这一支里**根本不加载**（动态 import），
//   #plan 容器也永远为空（index.html 里 :empty{display:none}）。
//   想动这个判断之前先想清楚：出片画面变了是要重新对拍全片的。
if (!params.has('render')) {
  void import('../../plan-ui/mount').then((m) => m.mountPlanPanel())
}
