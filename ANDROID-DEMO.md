# Android 演示版说明（Tauri 2 壳 + 自建登录）

这是 gloss-upstream（Orivell）的安卓演示版 APK。壳用 Tauri 2，里面加载生产版服务。
登录已按《docs/账号系统自建方案.md》完整自建（邮箱+密码+会话 Cookie），**没有任何
Clerk / 海外云依赖**，手机上打开秒开、登录可用。

## 手机上安装

1. 手机和电脑连同一个 WiFi；
2. 电脑上跑着演示服务（`start-demo-server.bat`，端口 3101）；
3. 浏览器打开 <http://192.168.0.101:3110/orivell-demo.apk> 下载安装（允许未知来源）；
4. 打开 app → 右上角"登录" → 输入账号密码。

## 账号：先把你的旧书架认领回来

Neon 里现存的 1039 篇文章挂在旧 Clerk 用户 id 下。跑一次收编脚本，把那个 id
变成你的自建账号（不动任何数据行）：

```
cd gloss-upstream
node --env-file-if-exists=.env.local scripts/adopt-clerk-user.mjs
```

按提示输入邮箱、密码（≥10 位）、名字即可。之后手机和电脑浏览器用这套邮箱密码登录，
看到的是同一个书架。不跑脚本也可以直接在 /sign-up 注册新账号（那是空书架）。

## 电脑上要跑的东西

- **演示服务（3101）**：双击 `gloss-upstream\start-demo-server.bat`。
- **APK 下载服务（3110，装完可关）**：`D:\Android\apks\serve-apk.bat`。
- 防火墙已放行 3101 / 3110 两个入站端口（规则名 "Orivell demo 3101" / "Orivell apk download 3110"）。

## 忘记密码（决定：暂不接邮件，走服务器端重置）

- **服务器端重置（唯一启用路径）**：`node --env-file-if-exists=.env.local scripts/reset-password.mjs`，
  按提示输邮箱和新密码即可，旧会话全部退出。
- 邮件自助重置的代码保留在仓库里（登录页"忘记密码？"入口、/api/auth/forgot、/reset-password），
  但未接邮件通道——页面上会提示"邮件服务未配置"。哪天要启用，接一条通道（QQ 邮箱 SMTP 或
  Resend）并配好密钥即可，业务代码不用再动。

## 每日复习推送（决定：暂不启用）

代码保留（/api/cron/daily-review + lib/mail.ts），未接邮件通道，不会触发。哪天接了邮件，
配好 `RESEND_API_KEY` + `CRON_SECRET` 后，用 crontab 每天 07:00 curl 一次该端点即可。

代码已就位（`lib/mail.ts` + `app/api/cron/daily-review` + `lib/cron.ts`），生效需要
在 `.env.local` 里加：

```
RESEND_API_KEY=re_xxx        # resend.com 免费层 3000 封/月
CRON_SECRET=随便一段长随机串  # 保护 cron 端点
# RESEND_FROM=you@yourdomain.com   # 有验证域名才填；不填只能发到 Resend 注册邮箱
```

触发：`curl "http://127.0.0.1:3101/api/cron/daily-review?key=$CRON_SECRET"`，
部署后配 Vercel cron 或服务器 crontab 每天 07:00。

## 下一步：部署到你的服务器

app 与 Clerk/Neon 的耦合已全部解除，`DATABASE_URL` 指向任何 Postgres 都能用：

1. 服务器上装 Postgres（Docker 一行：`postgres:16`；**镜像要带 pgvector**，如
   `pgvector/pgvector:pg16`，因为 schema 用了 vector 扩展）；
2. `pg_dump` 从 Neon 导出、restore 进自建库（数据就一份书架，很小）；
3. 服务器上跑 `npm run build --webpack && npm start`（或 `output: "standalone"`）；
4. `src-tauri/tauri.conf.json` 里 `frontendDist` / `windows[].url` 换成服务器地址，
   重新 `npx tauri android build --debug --apk`。

注意：`scripts/` 里除 migrate 外的工具脚本（db:check、import-x 等）还引用着 Neon
专用的 HTTP 驱动，切到自建库后需要时再逐个换（都是独立工具，不影响 app）。

## 重建 APK（工具全在 D:\Android，C 盘零污染）

在 `gloss-upstream` 目录：

```bash
export RUSTUP_HOME='D:\Android\rust\rustup' CARGO_HOME='D:\Android\rust\cargo' \
  ANDROID_HOME='D:\Android\android-sdk' NDK_HOME='D:\Android\android-sdk\ndk\26.3.11579264' \
  JAVA_HOME='D:\Program Files\Java\jdk-17' GRADLE_USER_HOME='D:\Android\gradle-home' \
  ANDROID_USER_HOME='D:\Android\user-home'
export PATH="/d/Android/bin:/d/Android/rust/cargo/bin:/d/Android/android-sdk/platform-tools:/d/Android/w64devkit/bin:$PATH"
npx tauri android build --debug --apk
```

产物：`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
（只含 arm64；Gradle 里的 `BuildTask.kt` 被改为直连 node 跑 Tauri CLI，绕开
npm 在 git-bash 下的脚本壳问题——重新 init 后需要重打这个补丁）。

## 这套工具链/代码的四个坑

1. **`npm run build`（Turbopack）在本机是坏的**：lib/tweet.ts、lib/cn.ts 等
   文件里 execFile/spawn 的 Windows 绝对路径字面量会让 Turbopack 报
   "a component does not exist"。用 `npx next build --webpack` 代替；
   另外构建时必须先停掉 3101 服务，否则 webpack 哈希器会崩。
2. **构建/启动必须在 gloss-upstream 目录里跑**（cd 后再执行）。
3. **`.cargo/config.toml` 不在仓库里**（它写死了本机 NDK 路径，已忽略）。
   换机器或新 clone 后需要自己建，否则 Android 交叉编译会找不到 linker：

   ```toml
   # .cargo/config.toml
   [target.aarch64-linux-android]
   linker = "<NDK>/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android24-clang.cmd"
   [target.x86_64-pc-windows-gnu]
   rustflags = ["-C", "link-self-contained=yes"]
   ```

4. **APK 不进仓库**：`src-tauri/gen/android/**/build/` 已忽略（单个 .so 就
   123MB，超 GitHub 100MB 单文件限制）。APK 只在本地 `D:\Android\apks\`
   分发，要发布就挂 Release 附件（Release 单文件上限 2GB）。
