# 循序 · 公开训练计划与云档案

[打开完整训练计划](https://renmusalv.github.io/xunxu-marathon-planner/)

GitHub Pages 直接提供完整课表、成绩图片识别、个人资料与目标能力评估页面。访问与试用不需要 ChatGPT 账号。邮箱验证码登录和共享密码登录都使用 Supabase 云档案；共享密码登录下，使用同一密码的设备访问同一个 Supabase 账号和同一组档案。

## 课表与资料填写

半马课表以用户提供的 **1:45 和 1:50 两张七周参考图**分别校准。每周的四次跑步、一次力量、两天休息，以及专项自测和减量节奏保持共同结构；各类训练配速分别读取参考值。例如，有氧跑从 6:00–6:30 调为 6:10–6:40，节奏跑从 4:50–4:55 调为 5:05–5:10，因此不能用一个固定偏移量还原两张图。

- 目标为 1:45 或 1:50：采用对应参考图的训练配速。
- 目标介于两者之间：对各节课、各配速区间端点分别插值，标明为推导课表。
- 目标位于区间之外：从最近参考图按目标均速差外推，标明为外推参考；两个样本不足以证明其他目标的训练量适合每个跑者。
- 比赛日用目标总秒数除以 21.0975 km 精确计算，显示时四舍五入。原图唤醒课的 4:58 / 5:12 标注保留，比赛日对应显示为 4:59 / 5:13，不会因此更改目标用时。

**目标决定主课表；个人能力另列为完成难度、建议配速与心率参考。** 个人资料、实绩和跑量变化不会悄悄改写目标课表。

日常表单只突出比赛目标、近期实绩和训练基础。周跑量、每周跑步天数、近 30 天最长跑、近 4 周训练连续性及当前身体状态用于能力和负荷判断；新档案不预填虚构训练基础。未填写基础仍可查看半马目标课表，但难度判断会说明证据不足。

年龄和累计跑龄不参与现有计算，因此不再要求填写；历史档案中的值保留。心率资料和设备 VO₂max 收入选填区域，只有需要相应参考时才填写。平均心率与本次最高心率属于实绩记录，截图里的峰值不会自动覆盖个人最大心率。

截图 OCR 在浏览器中读取中英文文字，并结合文字在图中的位置识别多列数据。识别结果先填入核对表，用户确认后才进入评估。日期、用时、心率或标签含糊时会保留待核对状态，不能保证任意应用、字号和截图布局都可准确识别。

## 手机操作

900 px 及以下使用顶部「个人资料 / 课程安排」切换。资料分为「下场比赛」「历史成绩」「当前基础」：未来的比赛日期、距离、目标用时与已经完成的成绩、近期训练情况分别填写。

- 目标用时和实际成绩采用「时 / 分 / 秒」分栏数字输入，无需输入冒号；支持粘贴完整时间。旧档案、OCR 回填与原有保存格式保持兼容，缺少分段或超范围时明确提示，不推测错误数字。
- 课程页先展示目标摘要和当天训练，默认定位今天所在周；可下拉或用箭头切周、点星期切天、左右滑动当天卡片。每次只展示所选一周与一天，同档案重算保留所选日期，切换账号或档案重置。
- 首页完整评估、课程页计划概览和课表依据默认折叠，按需展开；当天训练仍同时显示目标要求、当前能力建议和打卡。
- 点击生成后进入课程顶部；填写字段的自动重算保持在资料页，校验失败则定位到对应字段。桌面继续提供完整周表。
- 手机隐藏的课程仍留在课表数据和 DOM 中，打卡总数与历史训练统计覆盖整个计划。界面选择状态只在内存中，不增加本地业务存储。

## 首页目标与健康数据导入

首页在半马主题头图下置顶「下一场目标完成适配度」：展示当前档案、目标时间、比赛日期、准备度环形图和成绩依据。有效评分用 `/100` 表示；资料不足、恢复暂缓或目标输入无效时不伪造零分或成功概率。详细依据、心率与建议配速点击展开。头图随页面上滑离开视野，手机主标签固定在顶部，也可以手动收起 / 展开头图。

**当前 GitHub Pages 网页不能直接请求 Apple HealthKit 或 Android Health Connect 的系统授权。** 这些能力需要原生应用的 entitlement / SDK 与系统权限流程。网站安装到主屏幕不会自动获得该能力。本版提供可用的 Apple 健康导出文件导入，不称作「已授权」或「持续同步」。

使用方式：iPhone「健康」→ 摘要 → 头像 → 导出所有健康数据 → 存储到「文件」；在网站选择 ZIP 或解压后的健康主数据 XML。中文文件名 `导出.xml`、英文 `export.xml` 和其他名称均可；无需改名。解析在浏览器内进行；原始导出文件、定位轨迹和无关健康记录不会上传到网站服务器。用户核对并选择的训练摘要通过现有档案流程保存，公开试用仍仅在页面内存中保留。

ZIP 会按实际 XML 根节点 `HealthData` 识别主数据，而非锁定英文文件名。支持嵌套目录和非 UTF-8 文件名；忽略 `__MACOSX` / AppleDouble 元数据及 `ClinicalDocument` 辅助 XML。自动探测最多 32 个 XML，每个最多读取 1 MiB 前缀；若发现多个健康主数据文件，会要求解压选择，避免混入其他人的导出。选定文件仍执行完整结构、大小及 CRC 校验。

- 最近 28 个完整日的跑步里程和跑步日用于周均摘要，排除当天尚未结束的数据；近 30 天最长跑另行统计。
- 只统计跑步训练，合并近似重复的设备记录。已记录数据不等于完整训练史，因此应用周跑量和频率前，需要确认记录完整；周均天数有小数时由用户确认常态，不擅自四舍五入。
- 可读取有日期、来源的静息心率与 VO₂max。导入 VO₂max 的测量方式默认「待确认」，不假定一定来自手表或实验室。心率峰值不自动填入个人最大心率，设备 VO₂max 不直接改变准备度评分。
- 接近 10 km / 半马的历史跑步只保留近一年最新的最多 12 条候选线索，可回填日期、实际记录距离提示、用时、记录内平均 / 最高心率；其他历史跑步不会逐条加入档案。只有用户核对比赛性质、标准距离与完整计时后，才进入现有能力评估规则；普通训练不能自动当作全力比赛。
- 不再设置 256 MiB 文件大小上限；文件在浏览器本机流式读取，不上传原始 ZIP/XML。ZIP 仍仅支持普通 stored / deflate、未加密、非 ZIP64 的 Apple 导出包，并验证 CRC、大小和压缩比；实际可读范围受浏览器、设备内存和 ZIP 格式限制。不支持 `DecompressionStream('deflate-raw')` 的浏览器会提示先解压选择 XML。
- 解析、应用和候选成绩均绑定当前账号与档案；切换档案取消未完成读取，账号变化清空导入摘要。原始文件不保留，取消或失败不会把未核对记录当作已应用数据。

官方依据：[Apple HealthKit 配置](https://developer.apple.com/documentation/healthkit/setting-up-healthkit) · [Android Health Connect 集成](https://developer.android.com/health-and-fitness/health-connect/get-started) · [Apple 健康导出说明](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios)。

头图 `assets/half-marathon-hero.jpg` 为内置 image_gen 生成的示意图片（2172 × 724），不是某场真实赛事的新闻照片。生成提示词："Wide 3:1 documentary sports photograph of adult half-marathon runners training on a tree-lined road at dawn; runners on the right, darker forest negative space on the left for HTML text; forest green and sage with warm cream light; calm, credible editorial feel; no text, logos or watermark." 构建只发布此明确允许的图片，不复制任意 `assets/` 文件。

## 默认发布状态

仓库中的 `src/cloud-config.js` 默认如下：

```js
window.XUNXU_CONFIG = {
  supabaseUrl: '',
  supabasePublishableKey: '',
  emailLoginEnabled: false,
  sharedLoginEmail: '',
  passwordLoginEnabled: false
};
```

默认状态可公开试用训练计划。试用的资料、截图与打卡只保留在当前页面内存中，刷新或关闭页面后不保留；页面会说明云服务尚未接通。空配置不会启用登录，不会把试用结果显示为已保存到服务器，也不会回退到浏览器本机业务存储。

配置真实 Supabase 项目、数据库与图片权限，并验证相应认证方式和云保存后，才应启用登录开关。一次静态构建成功只证明网站资源能够生成，不证明登录或云保存已经可用。

## 代码与发布结构

| 路径 | 用途 |
| --- | --- |
| `index.html`、`src/` | 当前完整公开应用的可维护源代码 |
| `src/cloud-config.js` | 可公开的项目 URL、公钥、邮箱验证码与共享密码登录开关、共享账号邮箱 |
| `src/supabase-cloud.js` | Supabase 邮箱验证码 / 共享密码认证与云端适配 |
| `src/profile-store.js` | 当前页面草稿、档案状态与保存流程 |
| `src/assessment.js`、`src/target-plan.js`、`src/session-advice.js` | 能力评估、目标课表及个人能力旁注 |
| `src/ocr.js` | 浏览器内图片处理、OCR 与成绩字段提取 |
| `scripts/build-static.cjs` | 清理并构建完整 `dist/`，只对输出文件应用公开配置覆盖 |
| `scripts/vendor-cloud.cjs` | 从锁定的官方 npm 包生成本地 Supabase 浏览器 SDK |
| `scripts/vendor-ocr.cjs` | 从锁定依赖生成 OCR 引擎、worker、内嵌 WebAssembly 内核和中英文模型 |
| `supabase/migrations/202611110001_cloud_profiles.sql` | 数据表、访问隔离与图片相关的服务端迁移 |
| `supabase/README.md` | 后端账号、数据库和图片权限配置说明 |
| `tests/` | 目标课表、能力评估、档案、云适配、数据库权限和发布边界回归 |
| `.github/workflows/deploy.yml` | 安装依赖、测试、构建后，将 `dist/` 发布到 Pages |

根目录源码是当前版本，不再以压缩包作为新版应用的唯一文件集。`node_modules/` 与 `dist/` 已被忽略，不需上传到源码仓库。OCR 与 Supabase 运行组件在构建时生成；访问者使用本站提供的固定版本文件，不依赖浮动版本的运行时 CDN。

## 本地运行

使用 Node.js 24：

```sh
npm ci --no-audit --no-fund
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

打开 `http://localhost:8000/`。没有 Python 时，也可使用其他静态服务器提供 `dist/`。不要直接用文件协议打开页面。

构建会先删除旧 `dist/`，然后复制根 `index.html` 与 `src/` 下的 JS/CSS，生成公开配置、Supabase SDK、OCR 资源和 `.nojekyll`。应用文件以平铺结构输出；脚本、样式及 OCR 地址支持 GitHub Pages 的仓库子路径，也支持根域名。

测试中的发布检查会在临时目录生成完整静态产物，验证旧入口、服务器包、源码 ZIP 和本机配置不会混入网站。数据库测试使用本地测试环境；它们不会替代真实 Supabase 项目的配置和投递验证。

## 接通邮箱验证码 / 共享密码登录与云保存

### 1. 创建并配置 Supabase 项目

在你控制的 Supabase 项目中，按 [supabase/README.md](supabase/README.md) 应用 [数据库迁移](supabase/migrations/202611110001_cloud_profiles.sql) 并检查私有图片桶及访问策略。密码校验由 Supabase Auth 完成；数据库和图片访问由服务端权限控制，不依赖前端提供的用户 ID 来授权。

从 Supabase 项目连接信息中获取项目 URL 与 **publishable key**。当前构建只接受 `sb_publishable_` 开头的公开密钥。`sb_secret_`、`service_role` 和其他服务器凭据不能进入前端、仓库或 Pages 产物；构建会拒绝将它们作为发布公钥。

官方说明：[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)。

### 2. 创建共享登录账号

在 Supabase Auth 中使用现有的已确认账号作为共享账号，并为它设置网页登录密码。若要保留该账号当前的服务器资料，`SHARED_LOGIN_EMAIL` 必须指向拥有这些资料的同一个 Supabase 用户；新建另一个用户不会自动迁移旧档案。不要把密码写进源码或构建变量。所有登录者会共用该账号下的档案、成绩、截图和打卡。

共享密码登录使用 Supabase Auth 的密码认证，不发送验证码；共享密码会由 Supabase Auth 私下校验，不能写入源码、仓库变量或网页配置。邮箱验证码登录继续使用各自的 Supabase 用户和独立档案，需配置 Email OTP 与邮件投递服务。

### 3. 设置公开配置值

推荐在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 中设置：

| 变量 | 示例 / 含义 |
| --- | --- |
| `SUPABASE_URL` | `https://你的项目标识.supabase.co`，使用 HTTPS 项目根地址 |
| `SUPABASE_PUBLISHABLE_KEY` | 项目提供的 `sb_publishable_…` 公钥 |
| `EMAIL_LOGIN_ENABLED` | 启用邮箱验证码登录时设为 `true`，否则设为 `false` |
| `SHARED_LOGIN_EMAIL` | 上一步创建的共享 Supabase Auth 账号邮箱 |
| `PASSWORD_LOGIN_ENABLED` | 完成共享账号与云保存验证后设为 `true`，否则保持 `false` |

这些值会公开出现在浏览器中，不是服务器秘密。也可编辑 `src/cloud-config.js` 中对应的公开字段作为默认配置。非空环境变量优先于源码默认值，构建只改写 `dist/cloud-config.js`，不会改动受版本控制的配置文件。

两个登录开关只接受 `true` 或 `false`。空配置与 `false` 可以正常构建试用版；启用任一登录方式却缺少项目 URL 或公钥，或启用密码登录却缺少共享账号邮箱时，构建会停止，避免发布误导性的登录状态。

设置变量后，手动运行 GitHub Actions 的 **Test and deploy public planner** 生成新发布版本。仅修改仓库变量不会改写已经发布的静态文件。

## GitHub Pages 自动发布

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。推送到 `main` 或手动运行工作流后，依次执行：

```text
npm ci → npm test → npm run build → 上传 dist → 部署 GitHub Pages
```

发布使用 GitHub 官方 Actions 和自动提供的短期权限，不需要个人访问令牌。Pages 产物仅为 `dist/`；数据库迁移、SMTP 配置、源码备份与历史服务端代码不会通过这个工作流部署为后端。

## 资料与登录会话

**训练业务资料不使用 localStorage、sessionStorage 或 IndexedDB 保存。** 试用草稿只在当前页面内存中；实际云保存是否成功，以界面的保存状态为准。退出页面前尚未成功保存的修改不会成为云端数据。

**登录凭证与训练资料不同。** Supabase SDK 会在浏览器中保留登录会话，以便刷新后继续使用。此处保留的是认证会话，不是个人资料、成绩、截图、计划或打卡副本；认证模块负责登录会话的续期与退出。不能因此将本版本描述为“浏览器中完全没有任何登录令牌”。

图片 OCR 在浏览器中执行，不发送到第三方识别服务。登录并保存截图时，图片通过已配置的云存储流程保存；访客未登录的试用图片不会被当作已保存资料。各账号及档案的数据隔离需要服务端数据库和图片权限共同生效。

## 历史版本

- [原 Sites 云端版本](https://xunxu-marathon-planner.smart-bean-0955.chatgpt.site/planner/index.html) 保持原访问范围，是历史服务，不是当前公开 Pages 的登录依赖。
- `cloud-source.zip` 与 `cloud-source.zip.sha256` 保留源码提交 `bb0ff7440a67ceaf655127e54675e9ccc38c68ec` 的旧 Vinext / D1 / R2 / Sites 身份版本快照。
- [最初静态版本提交](https://github.com/renmusalv/xunxu-marathon-planner/tree/02eb9eff599cf309f9cbe9fff517d783df095309) 继续可追溯。

旧浏览器本机数据、旧 Sites 云端数据与新的 Supabase 项目属于不同存储。当前公开版不自动迁移这些历史资料，也不会因为打开网页或完成登录就声称迁移完成。

训练建议与目标适配度用于辅助安排训练，不是个体达标概率或医疗诊断。
