# 灵感收集入口 / Inspiration Capture

把主动收集的链接、文字、个人评论和已经生成的点点总结写入自己的 Notion。保留原始收件箱，不强制分类，不调用 AI。此仓库是脱敏、可迁移的源代码存档，采用 MIT 许可证。

## 当前范围和验证边界

- 原有实现支持 HTTP Shortcuts 弹窗、可选评论、本地待上传队列、独立设备令牌、撤销、原编号重试、Notion 回执和后续总结追加。
- Worker + D1 负责幂等和队列状态；Notion 是资料库。D1 也保存请求原文，属于敏感数据，不应公开或放进 Git。
- 当前仅接收 JSON，整包最多 64,000 字节；服务端原文 16,000 字、评论 4,000 字。手机入口更保守：原文 8,000 字、评论 2,000 字，本地队列约 24,000 字，单次最多重试 3 条。这不是无限离线缓存。
- 图片、录音、文件上传、OCR、语音转写、AI 分类、浏览器扩展和苹果快捷指令均未实现。
- 脱敏存档在 Node 24.22.1 上通过构建和自动测试；Notion 在测试中使用本地模拟。公开版的独立云端部署未进行真实账号验收，不能把原作者线上测试当作他人的部署测试。

## 目录与运行依赖

`worker/index.js` 为主 Worker，`worker/phone.js.txt` 为已验证手机交互脚本，`worker/gateway.js` 为可选 Sites 转发器；`web/` 是 Sites 私有网页；`drizzle/` 是 D1 SQL；`tests/` 是本地测试；`tools/prepare-self-host.mjs` 只离线生成新部署的初始配置。

运行时只用 Worker Web API 和 D1，没有第三方运行时包。构建/测试使用 Node.js 24.22.1（含 node:sqlite、zlib.crc32）和 Git。锁定 pnpm 11.25.0、drizzle-kit 0.31.10、drizzle-orm 0.45.2 供维护数据库模型使用，见 pnpm-lock.yaml；已有 SQL 部署不需要重新生成迁移。

```sh
git clone https://github.com/Shian10O/inspiration-capture.git
cd inspiration-capture
node scripts/build.mjs
node --test tests/*.test.mjs
```

需要修改模型时才安装开发依赖：`pnpm install --frozen-lockfile --ignore-scripts`，审阅生成的迁移后再运行。仓库不含自动部署工作流。

## 两种部署模式

| 模式 | 可用入口 | 身份边界 |
| --- | --- | --- |
| 独立 Cloudflare Worker + D1 | HTTP Shortcuts 的设备提交接口 | `IDENTITY_PROVIDER=none`，不接受伪造的网页所有者请求；网页配置/管理接口返回 403 |
| Sites 私有网页 + 公网转发 Worker | 所有者网页及手机入口 | 仅在 Sites 确实校验并覆盖身份头、私有页面受平台保护时设 `IDENTITY_PROVIDER=sites`；转发器保留服务端凭据和上游固定白名单 |

没有通用的独立部署网页登录实现。不要为了打开网页把普通 Worker 的 IDENTITY_PROVIDER 改成 sites，也不要把 OWNER_EMAIL 当作密码。自部署手机模式不需要第二个转发器。

## 自己的 Notion 授权

在自己的 Notion 工作区创建独立数据库，建立下表属性，创建内部连接，授予读取、新增和更新内容权限，仅把该数据库连接给集成。不要复制别人的数据库标识或密钥。API 固定使用 `2026-03-11`。

| 属性 | 类型 |
| --- | --- |
| 标题 | title |
| 原始链接 | url |
| 原始内容、我的个人评论、来源、点点总结、入口记录ID | rich_text |
| 内容类型 | select：链接、文字、点点总结、图片（图片仅预留） |
| 收集时间 | date |
| 含点点已有总结 | checkbox |
| 处理状态 | select：收件箱、待整理、已整理 |

数据库页面 ID 与数据源 ID 不是同一个概念。通过 Notion 官方的 [获取数据库接口](https://developers.notion.com/reference/retrieve-a-database) 找到目标 `data_sources[].id`；NOTION_DATA_SOURCE_ID 填这个 UUID。不要把密钥放进 URL、截图或聊天记录。

## 首次独立部署（只适用于你自己的空数据库）

以下命令是操作手册，本仓库不会自动创建资源或自动使用付费套餐。先查看平台免费额度和账号计费设置。安装自己审核过的 Wrangler 4 版本，并把实际版本记录在个人运维记录中；这里的 `wrangler` 指该已安装版本，未锁定的 CLI 不属于复现保证。

1. `wrangler login`，复制 `wrangler.example.jsonc` 为忽略提交的 `wrangler.jsonc`。运行 `wrangler d1 create inspiration-capture`，把返回的 D1 ID 填入配置，同时填写自己的 NOTION_DATA_SOURCE_ID；IDENTITY_PROVIDER 保持 none。可增加 NOTION_DATABASE_URL 供链接使用。
2. `node scripts/build.mjs`。运行 `wrangler d1 migrations apply DB --remote`，仅对刚创建的空 D1 执行。先记录预期 Worker 地址，初次部署可能需要先部署后确认平台分配域名。
3. 在密码管理器或本地受保护、被忽略的 `.private/bootstrap-input.json` 中填写以下结构。先创建 `.private` 文件夹。示例不是可用密钥：

```json
{
  "dataSource": "11111111-1111-4111-8111-111111111111",
  "notionToken": "REPLACE_LOCALLY_WITH_YOUR_INTERNAL_CONNECTION_TOKEN",
  "endpoint": "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/capture",
  "label": "My Android"
}
```

4. 通过标准输入生成初始材料，避免密钥进入命令参数/历史：

```sh
node tools/prepare-self-host.mjs < .private/bootstrap-input.json
wrangler secret bulk .private/runtime-secrets.json
wrangler d1 execute DB --remote --file .private/bootstrap.sql
wrangler deploy
```

PowerShell 不支持上述 `<` 输入重定向，可改用 `Get-Content -Raw .private/bootstrap-input.json | node tools/prepare-self-host.mjs`。不要把文件内容直接粘入命令。若 secret bulk 提示 Worker 尚未建立，先部署空配置版本，再配置秘密并重新部署；未配置期间写入会失败关闭。

5. 在自己的安卓手机安装 HTTP Shortcuts（原实现测试版本 4.9.0），从文件导入 `.private/phone-import.zip`，选**合并**。首次仅用公开测试文字验证 Notion 记录和手机回执。导入包含可撤销设备令牌，应私下传输，不能上传到公开仓库。不要覆盖已有手机队列变量。

生成的 runtime-secrets.json 含 AES 根密钥，bootstrap.sql 含加密的 Notion 凭据和设备令牌哈希；手机 ZIP 含设备令牌，三者都不能公开。工具不会联网，不校验 Notion 授权是否真正成功。Windows 的文件 mode 不能替代账户访问控制；在受保护目录操作，迁入密码管理器/平台秘密管理后安全清理临时材料。

**初始化脚本只运行一次。** 它会生成新根密钥和设备令牌；现有服务升级不能重跑，否则可能导致旧配置无法解密或令牌不一致。

撤销设备使用自己的数据库控制台对 `devices` 的指定 `id` 设置 `revoked_at`。不要删除 events/records 以“清理失败”，这些表防止重复写入。追加新设备需要运营者生成独立令牌并插入哈希；当前独立部署没有网页发放界面。

## Sites 部署说明

拥有 Sites 工具的维护者可以使用 `.openai/hosting.json` 的 DB 绑定及构建产物部署到**自己创建的项目**。本仓库移除了原 project_id、所有者地址和站点地址，无法凭源代码访问原实例。私有主站设置四个秘密：CONFIG_ENCRYPTION_KEY、OWNER_EMAIL、SITE_SERVICE_TOKEN、CAPTURE_GATEWAY_URL，并设置 NOTION_DATA_SOURCE_ID 与 IDENTITY_PROVIDER=sites。可选转发器设置 UPSTREAM_ORIGIN、ALLOWED_UPSTREAM_ORIGIN（完全相同的 HTTPS origin）、UPSTREAM_SERVICE_TOKEN。主站平台访问控制必须保持私有，转发器只开放设备认证后的 POST /api/capture。

平台服务凭据只存服务端；不要放到手机。自部署不应复制 Sites 的平台访问头或使用别人实例。Sites 身份、D1 导出及部署账号属于平台依赖，普通 Git clone 不会迁移这些权限。

## 升级、备份和恢复

升级前记录 Git commit、CLI/Node 版本、Worker 配置、D1 ID、Notion 数据源 ID 和手机配置版本。备份 D1（其中有请求原文和设备哈希），另行加密保存；导出 Notion 内容及附件；把 AES 根密钥、Notion 凭据和平台恢复方式放在密码管理器，**都不提交 Git**。

恢复到同一平台：拉取固定 tag/commit，构建，使用原 D1、原根密钥、原数据源 ID 和原平台秘密配置，然后在独立环境用公开数据验证。原手机配置和待上传 UUID 保留不变，不重复初始化。已有服务无需旧电脑开机。

迁到新账号/平台：先恢复 D1 数据及秘密，再调整绑定和 HTTPS 域名；域名改变才更新设备 endpoint。根密钥与数据源 ID 共同决定解密，不能只恢复代码。首次新部署与灾难恢复不同，不能用 bootstrap 覆盖存量状态。回滚用升级前 commit 和数据库兼容快照；迁移先做副本演练，不盲目逆向执行 SQL。

| 故障 | 处理 |
| --- | --- |
| 手机未上传/回执丢失 | 保留原 UUID 和待上传队列，用重试入口；不要反复新建同样记录 |
| uncertain / 409 | 服务端无法确认是否已写入；人工按入口记录ID/追加标记核对，禁止盲重建 |
| Notion 401/403/404 | 核对集成访问目标库的权限、数据源 ID 和凭据；不把错误改成成功 |
| 429 | 按 Retry-After 等待，保留原编号 |
| 凭据失效/泄露 | 在平台安全设置撤销/重签；仅撤销泄露设备，不重置全部手机；若 Notion 密钥泄露也在 Notion 撤销 |
| 根密钥丢失 | 原密文无法解密，需重新授权 Notion 并规划受控修复；Git 不提供密钥恢复 |

更多安全边界见 [SECURITY.md](SECURITY.md)。
