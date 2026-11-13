# 循序 · 公开训练计划与邮箱云档案

[打开完整训练计划](https://renmusalv.github.io/xunxu-marathon-planner/)

GitHub Pages 直接提供完整课表、成绩图片识别、个人资料与目标能力评估页面。访问与试用不需要 ChatGPT 账号。邮箱验证码登录和跨设备云保存使用独立的 Supabase 项目，需要完成下述服务配置后才能启用。

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
- 能力评估、计划概览和课表依据默认折叠，按需展开；当天训练仍同时显示目标要求、当前能力建议和打卡。
- 点击生成后进入课程顶部；填写字段的自动重算保持在资料页，校验失败则定位到对应字段。桌面继续提供完整周表。
- 手机隐藏的课程仍留在课表数据和 DOM 中，打卡总数与历史训练统计覆盖整个计划。界面选择状态只在内存中，不增加本地业务存储。

## 默认发布状态

仓库中的 `src/cloud-config.js` 默认如下：

```js
window.XUNXU_CONFIG = {
  supabaseUrl: '',
  supabasePublishableKey: '',
  emailLoginEnabled: false
};
```

默认状态可公开试用训练计划。试用的资料、截图与打卡只保留在当前页面内存中，刷新或关闭页面后不保留；页面会说明云服务尚未接通。空配置不会发送验证码，不会把试用结果显示为已保存到云端，也不会回退到浏览器本机业务存储。

只有配置真实 Supabase 项目、应用数据库与图片权限、接通邮件服务并验证验证码登录之后，才应设置 `emailLoginEnabled: true`。一次静态构建成功只证明网站资源能够生成，不证明邮件投递或云保存已经可用。

## 代码与发布结构

| 路径 | 用途 |
| --- | --- |
| `index.html`、`src/` | 当前完整公开应用的可维护源代码 |
| `src/cloud-config.js` | 可公开的项目 URL、公钥和邮箱登录开关 |
| `src/supabase-cloud.js` | 独立邮箱认证与 Supabase 云端适配 |
| `src/profile-store.js` | 当前页面草稿、档案状态与保存流程 |
| `src/assessment.js`、`src/target-plan.js`、`src/session-advice.js` | 能力评估、目标课表及个人能力旁注 |
| `src/ocr.js` | 浏览器内图片处理、OCR 与成绩字段提取 |
| `scripts/build-static.cjs` | 清理并构建完整 `dist/`，只对输出文件应用公开配置覆盖 |
| `scripts/vendor-cloud.cjs` | 从锁定的官方 npm 包生成本地 Supabase 浏览器 SDK |
| `scripts/vendor-ocr.cjs` | 从锁定依赖生成 OCR 引擎、worker、内嵌 WebAssembly 内核和中英文模型 |
| `supabase/migrations/202611110001_cloud_profiles.sql` | 数据表、访问隔离与图片相关的服务端迁移 |
| `supabase/email-template.html`、`supabase/README.md` | 邮箱验证码模板与后端配置说明 |
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

## 接通独立邮箱登录与云保存

### 1. 创建并配置 Supabase 项目

在你控制的 Supabase 项目中，按 [supabase/README.md](supabase/README.md) 应用 [数据库迁移](supabase/migrations/202611110001_cloud_profiles.sql) 并检查私有图片桶及访问策略。用户身份应来自 Supabase Auth，数据库和图片访问由服务端权限控制；不要依赖前端提供的用户 ID 来授权。

从 Supabase 项目连接信息中获取项目 URL 与 **publishable key**。当前构建只接受 `sb_publishable_` 开头的公开密钥。`sb_secret_`、`service_role` 和其他服务器凭据不能进入前端、仓库或 Pages 产物；构建会拒绝将它们作为发布公钥。

官方说明：[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)。

### 2. 配置公开邮件投递与验证码模板

启用邮箱认证，并在 Supabase Auth 中配置自己的 SMTP 邮件服务。Supabase 默认测试邮件服务只向项目团队中的预授权地址投递，不能作为面向所有访客的邮箱登录服务。SMTP 主机、用户名、密码等只配置在 Supabase 服务端，不写进本仓库或 GitHub Actions 的公开变量。

将 [supabase/email-template.html](supabase/email-template.html) 用于相应的登录邮件模板。邮箱验证码模板需要包含 `{{ .Token }}`；仅调用 `signInWithOtp` 而保留默认邮件模板，收到的可能是登录链接。网站使用用户输入验证码并验证邮箱的方式登录。

在 Supabase URL 设置中填写本网站地址 `https://renmusalv.github.io/xunxu-marathon-planner/`，并按需要登记实际使用的本地测试地址。完成一次真实的验证码发送、收取、验证及云保存/读取测试后，再打开公开邮箱登录开关。

官方说明：[自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [邮箱 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)。

### 3. 设置三个公开配置值

推荐在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 中设置：

| 变量 | 示例 / 含义 |
| --- | --- |
| `SUPABASE_URL` | `https://你的项目标识.supabase.co`，使用 HTTPS 项目根地址 |
| `SUPABASE_PUBLISHABLE_KEY` | 项目提供的 `sb_publishable_…` 公钥 |
| `EMAIL_LOGIN_ENABLED` | 未完成服务验证时保持 `false`；确认邮箱与云保存可用后设置 `true` |

这些值会公开出现在浏览器中，不是服务器秘密。也可编辑 `src/cloud-config.js` 中对应的公开字段作为默认配置。非空环境变量优先于源码默认值，构建只改写 `dist/cloud-config.js`，不会改动受版本控制的配置文件。

`EMAIL_LOGIN_ENABLED` 只接受 `true` 或 `false`。空配置与 `false` 可以正常构建试用版；显式开启登录却缺少项目 URL 或公钥时，构建会停止，避免发布误导性的登录状态。

设置变量后，手动运行 GitHub Actions 的 **Test and deploy public planner** 生成新发布版本。仅修改仓库变量不会改写已经发布的静态文件。

## GitHub Pages 自动发布

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。推送到 `main` 或手动运行工作流后，依次执行：

```text
npm ci → npm test → npm run build → 上传 dist → 部署 GitHub Pages
```

发布使用 GitHub 官方 Actions 和自动提供的短期权限，不需要个人访问令牌。Pages 产物仅为 `dist/`；数据库迁移、SMTP 配置、源码备份与历史服务端代码不会通过这个工作流部署为后端。

## 资料与登录会话

**训练业务资料不使用 localStorage、sessionStorage 或 IndexedDB 保存。** 试用草稿只在当前页面内存中；实际云保存是否成功，以界面的保存状态为准。退出页面前尚未成功保存的修改不会成为云端数据。

**登录凭证与训练资料不同。** Supabase SDK 会在浏览器中保留登录会话，以便刷新后继续登录。此处保留的是认证会话，不是个人资料、成绩、截图、计划或打卡副本；认证模块负责登录会话的续期与退出。不能因此将本版本描述为“浏览器中完全没有任何登录令牌”。

图片 OCR 在浏览器中执行，不发送到第三方识别服务。登录并保存截图时，图片通过已配置的云存储流程保存；访客未登录的试用图片不会被当作已保存资料。各账号及档案的数据隔离需要服务端数据库和图片权限共同生效。

## 历史版本

- [原 Sites 云端版本](https://xunxu-marathon-planner.smart-bean-0955.chatgpt.site/planner/index.html) 保持原访问范围，是历史服务，不是当前公开 Pages 的登录依赖。
- `cloud-source.zip` 与 `cloud-source.zip.sha256` 保留源码提交 `bb0ff7440a67ceaf655127e54675e9ccc38c68ec` 的旧 Vinext / D1 / R2 / Sites 身份版本快照。
- [最初静态版本提交](https://github.com/renmusalv/xunxu-marathon-planner/tree/02eb9eff599cf309f9cbe9fff517d783df095309) 继续可追溯。

旧浏览器本机数据、旧 Sites 云端数据与新的 Supabase 项目属于不同存储。当前公开版不自动迁移这些历史资料，也不会因为打开网页或完成登录就声称迁移完成。

训练建议与目标适配度用于辅助安排训练，不是个体达标概率或医疗诊断。
