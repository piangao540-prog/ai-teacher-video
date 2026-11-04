# 新增 /studio 页面 —— Ant Design + Zustand 落地计划

> **这份是给新会话看的**，自包含，不需要读之前的对话。
> 仓库：`E:\ai-teacher`。所有命令在仓库根目录跑。

---

## 0. 一句话目标

新增一个 `/studio` 剧本概览页（Ant Design Table 展示 storyboard 的 7 个场景），
再用 Zustand 把「在表格里点中的那一刻」传给 `/editor`，让编辑器自动 seek 过去。

**学习目的大于产品目的**：这块是为了练 AntD 与跨路由状态，不是项目缺这两个页面。

---

## 1. 现状（动手前先看）

### 技术栈

- React 19.3 / TypeScript 5.9 / Vite 8
- **react-router 8.5.1 已装**（`import ... from 'react-router'`，不是 `react-router-dom`）
- 样式：CSS Modules（`*.module.css`）
- ESLint 已配：根目录 `eslint.config.js`，当前 **0 error / 6 warning**（`any` 是有意留的）

### 路由结构（`src/router.tsx`）

```
/         → AppLayout → Home   （Plan 生成面板 + Stage 播放器）
/editor   → AppLayout → Editor （字幕时间轴编辑器）
*         → AppLayout → NotFound
errorElement: RouteError（挂在父路由上，会替换整个 AppLayout）
```

`AppLayout` = 左侧边栏 + `<Outlet />`。

### 入口（`src/render/stage/main.tsx`）三个分支

```tsx
if (params.has('edit'))        → 渲染 Editor（旧地址，不经布局）
else if (params.has('render')) → 渲染 Stage  ★ 出片路径，不经过 Router
else                           → RouterProvider
```

### 数据来源

`out/render/storyboard.json`，类型定义在 `src/type/storyboard.ts`：

```ts
Scene     = { id: string; template: string; startMs: number; endMs: number; props: Record<string, unknown> }
Storyboard = { durationMs: number; audioFile: string; scenes: Scene[]; cues?: Cue[]; ... }
Cue       = { i: number; startMs: number; endMs: number; text: string; lines: string[] }
```

`/storyboard.json` 由 Vite 中间件直接服务（见 `vite.config.ts` 的 `stageDataPlugin`），
**不需要改后端**，前端 `fetch('/storyboard.json')` 即可。

---

## 2. 铁律（碰了就算做错）

1. **`?render=1` 这条路径不经过 Router，也不许引入 AntD。**
   它是 Playwright 逐帧截图、最后合成 mp4 的路径，要求**逐帧像素一致**。
   不要改 `main.tsx` 的那个分支，也不要让 antd 的样式进这条路径。
2. **AntD 只在 `/studio` 用，并且必须 lazy 加载**，让它成为一个独立 chunk。
3. **不要跑 `pnpm plan` / `pnpm say`** —— 会覆盖 `corpus/episode.json`、烧 LLM/TTS 调用。
4. **不要动 `src/render/scenes/`** —— 场景组件由用户自己维护。
5. 改完 UI 之后，**跑一次 `pnpm shot 20000`** 和改动前对比，确认出片页面没变。

---

## 3. 分步实施

### 第 1 步：装 AntD，搭 `/studio` 的壳

```bash
pnpm add antd
```

1. 新建 `src/pages/Studio.tsx`，先只放一个 `<Card title="剧本概览">占位</Card>`
2. `src/router.tsx` 里加路由，**必须 lazy**：

```tsx
import { lazy, Suspense } from 'react'
const Studio = lazy(() => import('./pages/Studio'))

// children 里：
{ path: 'studio', element: <Suspense fallback={null}><Studio /></Suspense> }
```

3. `src/AppLayout.tsx` 侧边栏加一条 `<NavLink to="/studio">剧本</NavLink>`

**验收**：`pnpm dev` → 点侧边栏「剧本」→ 页面能打开、侧边栏高亮、控制台无报错。

---

### 第 2 步：用 Table 展示场景

- `fetch('/storyboard.json')`，`useState<Storyboard | null>`，加 loading / error 分支
- 顶部一排 `<Card>` 或 `<Statistic>`：时长（秒）/ 场景数 / 字幕数
- `<Table>` 的列：

| 列 | 取值 |
|---|---|
| 场景 | `scene.id` |
| 模板 | `scene.template` |
| 开始 | `scene.startMs` 格式化成 `mm:ss` |
| 时长 | `endMs - startMs` |
| 段数 | `scene.props` 里的信息，或先留空 |

注意 **`rowKey="id"`**，否则 AntD 会给警告。

**验收**：表格显示 7 行，排序、分页能点。

---

### 第 3 步：Zustand 把「点击的时刻」传给编辑器

```bash
pnpm add zustand
```

1. 新建 `src/store/studio.ts`：

```ts
import { create } from 'zustand'

type StudioState = {
    focusMs: number | null
    setFocus: (ms: number | null) => void
}

export const useStudioStore = create<StudioState>((set) => ({
    focusMs: null,
    setFocus: (ms) => set({ focusMs: ms }),
}))
```

2. `/studio` 的表格加 `onRow`：点击 → `setFocus(scene.startMs)` → `useNavigate()('/editor')`

3. `/editor`（`src/editor/Editor.tsx`）读 store：

```tsx
const focusMs = useStudioStore((s) => s.focusMs)
const setFocus = useStudioStore((s) => s.setFocus)

useEffect(() => {
    if (focusMs === null || !storyboard) return   // ★ storyboard 是异步来的，必须等它
    player.seek(focusMs)
    setFocus(null)                                 // 用掉就清，否则下次进来还会跳
}, [focusMs, storyboard])
```

**验收**：`/studio` 点第 3 个场景 → 跳到 `/editor` → 播放头停在那个场景开头。

---

### 第 4 步（可选）：侧边栏折叠 + persist

同一个 store 里加 `collapsed` + `toggle`，用 zustand 的 `persist` 中间件写 localStorage。
`AppLayout` 读它控制侧边栏宽度。

**这一步是为了演示 `persist`**，不做也不影响前三步。

---

## 4. 验收清单

- [ ] `pnpm typecheck` → 0 错误
- [ ] `pnpm exec eslint src` → 0 error
- [ ] `/studio` 表格显示 7 个场景
- [ ] 点场景 → `/editor` 定位到那一刻
- [ ] **`pnpm shot 20000`** 出片截图与改动前一致（这条别省）
- [ ] `?render=1` 打开仍是纯 Stage，没有侧边栏、没有 AntD 样式

---

## 5. 已知取舍（面试时会被问）

**「为什么用 Zustand，不用 URL 参数？」**

这个场景用 `/editor?t=12345` 也能做，而且更简单。用 store 的理由是：

- 它演示的是**跨路由共享状态**这一标准解法
- 后面这块读写会变多，收在一个地方比每次改 URL 省事

**诚实回答比编一个「非它不可」的理由更可信。** 不要把这段说成「必须用 Zustand」。

**「为什么 AntD 要 lazy？」**

因为 `?render=1` 是逐帧截图的出片路径，要求像素一致。AntD 有全局样式和 transition，
不能让它进这条路。lazy 之后 `/studio` 是独立 chunk，出片路径根本不下载它。

---

## 6. 完成后可以补进简历的句子

> 用 Ant Design 实现剧本概览页（Table + Card），以 Zustand 管理跨路由的编辑器定位状态；
> 组件库按路由懒加载，出片路径保持零依赖。
