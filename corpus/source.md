# 我的博客图片上传与懒加载实践

我的博客一直只有纯文字，想给文章加图片。本以为是加个按钮的事，真做起来才发现一条完整的"图片管线"：上传前压缩、上传后存储、渲染时懒加载。这篇文章记录完整过程。

## 一、为什么上传前要压缩

图片是页面体积的大头。一张手机拍的照片动辄 3-5MB，如果原样上传，存储和加载都是负担。

我的方案是前端用 canvas 压缩后再上传：

```js
const scale = Math.min(1, maxSize / Math.max(img.width, img.height)) // 最长边压到 900px,小图不放大
canvas.width = img.width * scale
canvas.height = img.height * scale
ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
const dataUrl = canvas.toDataURL(outputType, quality)
```

关键点：PNG 保留透明背景但体积大，JPEG 有损压缩体积小但会丢透明，所以代码里按原图类型做取舍。实测两个例子：一张纯色 1920x1080 的图从 154KB 压到 0.6KB；一张 800x800 的复杂壁纸从 659KB 压到 81KB，体积减少 87.7%。

![示例壁纸图 1](/api/images/6)

## 二、图片存在哪？base64 存 MySQL

后端部署在 Vercel（serverless），**没有持久磁盘**——用 multer 存本地文件，实例一换就丢了。所以我的方案是：前端压缩成 base64 字符串 → 后端校验后存进 MySQL 的 images 表 → 返回图片 URL。

生产环境一般会换对象存储（OSS 等），但博客项目用"压缩 + 存库"最简单，也够用。代价是数据库会变大，所以后端必须做大小兜底：base64 超过 200 万字符直接拒绝。

![示例壁纸图 2](/api/images/7)

## 三、踩过的坑（每个都是真金白银）

**1. 手敲代码，7 个 bug 一次报齐。** 方法名 `quire` 写成 `query`、表名 `iamges`、格式 `jepg`、大小限制 `700000000`（多了三个零）、路由少写 `api/`、还有两行把整段代码写进了字符串里。全是眼睛看着对、一跑就崩的类型，最后靠 `node --check` 和真实请求一个个抓出来。

**2. canvas 重编码 PNG 会越压越大。** 我传一张 150KB 的图，居然报"图片太大"——因为 canvas 对 PNG 的重编码远不如原图文件优化，大尺寸复杂图会膨胀好几倍。解法是后端留兜底上限，前端压缩后也复查一次，超了就提示换图。

**3. 改了代码不生效，原来是旧进程占着端口。** 排查半天发现 8 天前启动的旧 node 进程一直占着 3000 端口，新代码根本没起来。`netstat -ano | findstr :3000` 一查就现形。

**4. 文章发出去，才发现自己代码的 bug。** 发布后 markdown 没渲染、图片全挂。第一个：详情页用 `includes('<')` 判断"是不是 HTML"，文章代码块里的 `<` 触发误判，导致 markdown 原样输出——改成"开头是 `<`"就修好了。第二个：marked v18 的渲染器签名从位置参数改成了传对象，`image(href, ...)` 里的 `href` 其实是整个 token，图片 src 变成 `[object Object]`——用解构 `image({ href, tokens })` 修复。这两个 bug 都是发布后真实测试抓出来的。
![示例壁纸图 3](/api/images/8)

## 四、渲染端：图片懒加载

文章内容用 marked 渲染，我给图片渲染器加了一行属性：

```js
const markdownRenderer = {
    // marked v5+ 渲染器接收 token 对象,不是位置参数
    image({ href, tokens }) {
        const text = tokens.map((t) => t.text).join('')
        return `<img src="${href}" alt="${text}" loading="lazy" />`
    }
}
marked.use({ renderer: markdownRenderer })
```

`loading="lazy"` 是浏览器原生懒加载：图片进入视口才发起请求。打开页面只加载第一屏的图，往下滚才加载后面的，首屏请求数明显减少。

![示例壁纸图 4](/api/images/9)


## 壁纸图集（懒加载实测）

以下图片都是通过上传接口入库的，打开文章时只加载第一屏，滚动到才逐个加载：

<div class="image-gallery">
  <img data-src="/api/images/10" alt="壁纸 1" />
  <img data-src="/api/images/11" alt="壁纸 2" />
  <img data-src="/api/images/12" alt="壁纸 3" />
  <img data-src="/api/images/13" alt="壁纸 4" />
</div>

## 总结

这条管线有三层思路，也是我面试会讲的：**压缩控制源头体积，前后端各校验一次（前端防手滑、后端防坏人），懒加载控制请求时机**。做完之后，博客从"只能发文字"变成了"能图文混排"，我也把整个流程理解透了。