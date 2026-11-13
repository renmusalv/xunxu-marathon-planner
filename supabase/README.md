# 循序：登录账号与私有云档案

这套后端供公开静态训练计划使用。访客可以直接生成计划、填写资料和识别截图；云端读写只向已验证的 Supabase Auth 账号开放，无需 ChatGPT 账号。网页提供邮箱验证码登录和可选的共享密码登录。共享密码登录的设备使用同一个 Supabase 账号和同一组档案；邮箱登录的用户各自隔离。

此目录包含可执行迁移、验证码邮件模板和部署说明。它不会创建 Supabase 账号、购买服务或迁移原 Sites 的 D1/R2 数据。原项目的数据保持原状。

## 1. 创建项目并运行迁移

在专用于本应用的 Supabase 项目中，用 SQL Editor 执行一次 `migrations/202611110001_cloud_profiles.sql`；使用 Supabase CLI 的项目也可按其迁移流程执行 `supabase db push`。此迁移有事务包裹，任一语句失败会回滚；不是可反复运行的种子脚本。

保持 Data API 的公开 schema 配置，不要将 `xunxu_private`、`auth` 或 `storage` 加入 Data API 的 exposed schemas。应用只通过 `public` 中列出的 RPC 和 Supabase Storage API 访问云端。

迁移创建以下内容：

| 对象 | 职责 |
| --- | --- |
| `public.xunxu_profiles` | 用 `(owner_id, id)` 共同标识档案；仅能 SELECT 当前已验证账号的数据，禁止客户端直接增删改 |
| `xunxu_private.image_uploads` | 管理上传凭据、当前关联图片、退休图片和重试清理状态；客户端不能直接查询或修改 |
| 8 个 `public.xunxu_*` RPC | 核验身份、归属、字段、数量和 revision；控制档案与图片关联的写入 |
| `storage.objects` 的 RLS policies | 只允许凭据指定的私有上传、自己的已关联图片读取和已授权清理；禁止覆盖已有文件 |

RPC 使用受控的 `SECURITY DEFINER`：固定空 `search_path`，所有引用明确指定 schema，默认执行权限已撤销，仅向 `authenticated` 授权所需入口。每个入口重新检查 `auth.uid()` 对应的真实 `auth.users` 行、邮箱确认时间和匿名状态；不接收调用者传入的 owner。规则与验证在数据库执行，不能通过绕过网页来绕过 CAS 或档案隔离。

参考：[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Database Functions](https://supabase.com/docs/guides/database/functions)。

## 2. 创建私有图片 bucket

在 **Storage → New bucket** 创建以下 bucket，也可通过受信任的管理环境使用 Storage API 创建：

| 设置 | 值 |
| --- | --- |
| 名称 / ID | `xunxu-results` |
| Public bucket | **关闭** |
| File size limit | `12582912` bytes，即 12 MiB |
| Allowed MIME types | `image/png`、`image/jpeg`、`image/webp` |

不要把 bucket 改为公开，也不要另加允许匿名访问它的业务逻辑。准备上传的 RPC 会检查 bucket 存在且为 private。迁移内的 restrictive policies 还会约束这个 bucket，避免项目其他宽泛的 permissive Storage policies 意外放开它。

**不要通过 SQL 增删 `storage.objects` 或修改文件元数据来管理真实文件。** Storage 的数据库行不等同于文件本体；删除和上传应走 Storage API。这也是迁移没有用 SQL 创建 bucket 或清理文件的原因。

参考：[Private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)、[Storage schema](https://supabase.com/docs/guides/storage/schema/design)。

## 3. 创建共享 Supabase Auth 账号

在 Supabase Authentication 中选定一个已确认邮箱的共享用户：

1. 启用 Email provider 的密码登录，并为这个账号设置网页登录密码。
2. 关闭普通用户注册和匿名登录。不要把 Supabase `service_role`、`sb_secret_` 或共享密码写进网页、仓库或 GitHub Variables。
3. 将共享账号邮箱作为公开变量 `SHARED_LOGIN_EMAIL` 配置到前端构建；网页收集密码并交给 Supabase Auth 校验。若需保留已有档案，必须使用当前档案所属的同一 Supabase 用户。
4. 验证登录、读取云端档案、新建档案、修改后保存、退出以及另一台设备重新登录后读取同一资料。

邮箱验证码登录使用独立 Supabase Auth 用户，每个用户拥有隔离档案。启用该方式时，配置 Supabase Email OTP 与可靠的邮件投递（通常需要 SMTP）。共享密码登录和邮箱验证码登录可同时启用。

所有使用共享密码的人都能读取和修改这组账号下的全部档案。请仅在你愿意共享同一资料空间的设备和用户之间使用此密码。

前端使用 `signInWithPassword({email, password})` 完成共享密码登录，邮箱验证码仍使用 OTP 流程。RPC 对未确认邮箱和匿名身份均拒绝云访问。

参考：[Supabase 密码认证](https://supabase.com/docs/guides/auth/passwords)。

## 4. 发布公开前端配置

按仓库根 README 的构建流程设置：

| 构建变量 | 内容 |
| --- | --- |
| `SUPABASE_URL` | 项目的 HTTPS 根地址 |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` 公钥 |
| `EMAIL_LOGIN_ENABLED` | 邮箱验证码登录启用后设为 `true`，否则为 `false` |
| `SHARED_LOGIN_EMAIL` | Supabase 中已确认的共享账号邮箱 |
| `PASSWORD_LOGIN_ENABLED` | 完成真实服务验证后设为 `true`；配置前保持 `false` |

这些前端配置会公开。**不得使用 service-role key、secret key、数据库连接密码或 SMTP 凭据替代公钥。** 用户身份来自 Supabase Auth 签发的会话令牌，私有数据访问由 RLS 与 RPC 控制；应用不从客户端自造 owner 或信任任意身份 header。

## RPC 契约

使用 `supabase.rpc(name, args)`。所有对象都是 JSON；时间为 UTC ISO 字符串，revision 从 1 开始。session 的用户信息由前端 `auth.getUser()` 获取，列表 RPC 只返回档案摘要。

| RPC | 参数 | 返回 |
| --- | --- | --- |
| `xunxu_list_profiles` | 无 | `{profiles:[{id,name,revision,updatedAt}]}` |
| `xunxu_get_profile` | `p_profile_id` | `{profile}` |
| `xunxu_create_profile` | `p_profile_id,p_name,p_data` | `{profile}` |
| `xunxu_save_profile` | `p_profile_id,p_revision,p_data,p_name:null,p_upload_id:null` | `{profile}` |
| `xunxu_prepare_image` | `p_profile_id,p_record_id,p_revision,p_mime_type,p_size_bytes` | `{uploadId,bucket,key,expiresAt}` |
| `xunxu_get_image_key` | `p_profile_id,p_record_id` | `{bucket,key}` |
| `xunxu_claim_cleanup` | `p_limit:10`，范围 1–25 | `{items:[{uploadId,bucket,key}]}` |
| `xunxu_ack_cleanup` | `p_upload_id` | `{ok:true}` |

`profile` 格式：

```json
{
  "id": "default",
  "name": "我的档案",
  "data": {"form": {}, "records": [], "plans": {}, "history": []},
  "revision": 1,
  "updatedAt": "2026-11-11T12:00:00.000Z"
}
```

`form` 保留编辑中的字符串，包括空值和尚未输完的内容。成绩记录、计划键、真实日期、数据长度与重复成绩由数据库校验。`hasImage` 始终由服务器根据当前关联重建；上传的 data URL、外部图片地址和其他未允许字段会被拒绝。图片 key 不进入档案 JSON，只能通过所属账号的图片 RPC 取得。

每个账号最多 100 个档案；每档案最多 100 条成绩、100 个计划及 100 个历史计划；规范化前后档案 JSON 均不超过 1 MiB。一次最多 20 个未到期上传凭据；准备上传与创建档案使用 owner advisory transaction lock，档案更新使用行锁和 CAS revision。

错误使用 `PT400`、`PT401`、`PT404`、`PT409`、`PT413`、`PT429`、`PT503` SQLSTATE；PostgREST 会将其映射为 HTTP 状态。`message` 为可显示文本，`details` 是包含 `code` 的 JSON 字符串。版本冲突例如：

```json
{"code":"REVISION_CONFLICT","currentRevision":4}
```

收到版本冲突时保留本地草稿，提示重新读取并核对；不能自动用旧的整份档案覆盖新 revision。

## 图片保存、原子性与清理

一次截图保存的顺序：

1. 用当前 revision 调用 `xunxu_prepare_image`，取得有效期 30 分钟的随机版本 key。
2. 用该账号的 Storage 会话调用 `upload(key,file,{contentType,upsert:false})`。不要改名或复用 key。
3. 图片上传成功后，以同一 revision、完整候选档案和 `p_upload_id` 调用 `xunxu_save_profile`。
4. 读取图片时先调用 `xunxu_get_image_key`，再用该账号会话调用 `storage.from(bucket).download(key)`；无需公开 URL。

保存 RPC 锁定档案和凭据，核对 revision、owner、profile、record、有效期，以及真实 `storage.objects` 的 owner、MIME 和大小。**档案内容、revision、图片关联与旧图退休在同一个 PostgreSQL 事务中提交。** Storage 文件上传是之前的独立操作，无法与 PostgreSQL 形成同一文件事务；网络失败或 CAS 冲突留下的文件由下述队列处理，不会被当成成功关联。

图片一旦 attached 或 retired，凭据永远不能再次关联。替换图片使用新的随机 key；删除成绩会将其已关联图片退休。仅修改 `hasImage:false` 不会删除图片。上传 INSERT 的 RLS helper、关联和过期退休锁同一凭据行，并在取得锁后检查时效。

清理由已登录 owner 的客户端在 session/save 后尽力执行：

1. 调用 `xunxu_claim_cleanup`。它先将过期或 revision 已过时的 pending 凭据改为 retired，并设置 2 分钟宽限期；已被替换/删除的图可立即排入清理。返回的批次有 5 分钟清理租约。
2. 对每项用 Storage API `remove([key])` 删除；失败则不确认，租约到期后可再次领取。
3. 删除成功后调用 `xunxu_ack_cleanup`。数据库会确认对象元数据已不存在，再标记完成；它不会执行 SQL 文件删除。退休凭据保留为不可复用的墓碑。

清理失败不会回滚已经成功保存的档案。**此版本没有后台定时清理服务**；如果用户长期不再登录，退休或失败上传文件可能继续占用存储。需要固定回收期限时，应另行部署受信任的定时任务，遵守同样的退休状态和 Storage API 删除流程。管理员删除账号前也应先通过 Storage API 清理其图片，否则级联删除数据库行不会代替文件删除。

数据库验证 MIME 元数据与大小；它不读取文件内容做病毒扫描或服务端图片解码。前端会检查图片签名并处理截图。Bucket 的 MIME/大小限制仍须按上文配置。

## 测试与验证范围

运行：

```sh
node --test tests/supabase-schema.test.cjs
```

测试会在 `@electric-sql/pglite` 的实际 PostgreSQL 引擎执行完整迁移，建立最小 Auth/Storage schema，切换数据库角色与身份，验证 RLS 和权限，而非只搜索 SQL 文本。覆盖同名跨账号档案、同账号跨档案、匿名与未确认邮箱拒绝、直接 DML 拒绝、CAS、字段与上限、伪造图片标记、metadata 校验、票据生命周期、清理租约及其他宽泛 Storage policy 的防绕过。

PGlite 测试不包含 JWT 签名验证、Storage HTTP 文件服务或多条独立数据库连接的并发压测；创建限额所需 advisory lock 有明确检查，但完整并发行为仍应在目标 Supabase 项目做验收。上线前务必在目标项目验证共享账号保存、另一台设备重新读取、截图上传/读取、替换/删除和冲突处理。没有连接目标项目的验证不能当作该服务已经配置成功。
