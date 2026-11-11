# 循序 · 云端训练计划

按目标查看训练课表，结合真实成绩与个人资料，参考完成难度、配速和心率建议。训练档案、成绩图片与打卡记录由云端应用保存。

- [进入云端训练空间](https://xunxu-marathon-planner.smart-bean-0955.chatgpt.site/planner/index.html)
- [GitHub Pages 入口](https://renmusalv.github.io/xunxu-marathon-planner/)

云端训练空间保持原有访问范围，只向已获授权的账号开放。首次进入或登录状态失效时，按页面提示完成登录；公开的 GitHub 仓库和入口页面不会授予训练空间访问权限。

## 仓库与运行方式

| 内容 | 作用 |
| --- | --- |
| `pages-entry/index.html` | 当前 GitHub Pages 页面；仅提供云端入口，不在本机读取或保存训练资料 |
| `.github/workflows/deploy.yml` | 使用 GitHub 官方 Actions，仅将 `pages-entry/` 发布到 Pages |
| `scripts/build-static.cjs` | 本地构建入口页；先清空 `dist/`，再复制入口并生成 `.nojekyll` |
| `cloud-source.zip` | 新版云端应用的完整源码快照，供下载、审阅、恢复与重新构建 |
| `cloud-source.zip.sha256` | 对应源码压缩包的 SHA-256 校验值 |
| 根目录 `index.html`、`src/`、既有算法及存储测试 | 上一静态版本的参考代码，保留在 Git 历史与当前仓库中，不属于现在发布的 Pages 应用 |

新版云端源码快照使用 Vinext、D1 与 R2，并依赖部署平台提供的可信身份。压缩包包含依赖锁文件、应用和后端源码、数据库迁移、构建脚本及配置说明；不包含运行中的数据库、用户上传、会话、密钥或访问令牌。复现应用代码与构建产物，需要根据快照内说明配置相应服务及可信身份入口。

`cloud-source.zip` 是版本化的完整源码备份，不是能在 GitHub 页面中逐文件在线编辑的全栈工作目录。下载后解压到独立目录，使用其中的依赖文件和操作说明。完整文件集以压缩包为准。

当前云端快照源码提交：`bb0ff7440a67ceaf655127e54675e9ccc38c68ec`。构建及 118 项测试通过；数据库迁移随源码保存。完整性校验值见 `cloud-source.zip.sha256`。

## GitHub Pages 发布

Pages 只发布轻量入口，训练业务由云端站点运行。仓库的 **Settings → Pages → Source** 保持 **GitHub Actions**。修改 `pages-entry/` 或部署工作流并提交到 `main`，即可发布入口；也可手动运行 **Publish cloud training entry**。

工作流不安装 OCR 依赖、不运行根目录的旧应用构建，也不运行云端应用。公开仓库中的源码压缩包和其他代码不会进入 Pages 发布产物。

本地检查入口：

```sh
npm run build
npm test
python3 -m http.server 8000 --directory dist
```

根目录的 `npm run build` 只生成入口页。`npm test` 包含当前入口发布边界检查，以及保留的旧版算法、解析与隔离回归；新版云端业务以源码快照中的测试和构建流程为准。

本地预览地址为 `http://localhost:8000/`。进入训练空间的按钮会打开受授权保护的云端站点。

## 版本与数据

上一静态版本的完整提交为 [`02eb9eff599cf309f9cbe9fff517d783df095309`](https://github.com/renmusalv/xunxu-marathon-planner/tree/02eb9eff599cf309f9cbe9fff517d783df095309)，可查看或下载当时源码。

旧版按浏览器保存的资料与云端资料属于不同存储。入口页不会读取、上传或删除旧设备中的本机资料，也不会承诺这些资料已经完成迁移。当前版本不提供自动迁移；仅打开入口页不代表旧资料已同步。

云端的访问范围、身份校验、档案归属和图片权限由服务器执行。目标适配度与训练建议继续作为训练参考，不是个体达标概率或医疗诊断。

## 官方文档

- [GitHub Pages 自定义发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [通过网页上传仓库文件](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
