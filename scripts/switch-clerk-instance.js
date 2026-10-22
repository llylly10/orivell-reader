/**
 * 把 Clerk 换成自己的实例。
 *
 * 用法：
 *   node scripts/switch-clerk-instance.js <secret-key> [frontend-domain]
 *
 *   secret-key      sk_test_... （Dashboard → API Keys → Secret Key）
 *   frontend-domain 可选。开发实例的前端域名，如 dashing-prawn-4703。
 *                    不给的话，脚本会从 publishable key 反推。
 *
 * 会做的事：
 *   1. 验证 secret key 有效，读出实例 id
 *   2. 确定前端 API 域名，构造对应的 publishable key
 *   3. 检查这个实例启用了哪些社交连接
 *   4. 备份 .env.local 并写入新 key
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const ENV = path.join(ROOT, ".env.local");

function apiGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { host: u.hostname, path: u.pathname + u.search, method: "GET", headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(b) });
          } catch {
            resolve({ status: res.statusCode, body: { raw: b.slice(0, 300) } });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** publishable key 就是前端域名的 base64url（加 $ 结尾）。反推回来。 */
function domainFromPublishable(pk) {
  try {
    const b64 = pk.replace(/^pk_(test|live)_/, "");
    return Buffer.from(b64, "base64url").toString("utf8").replace(/\$$/, "");
  } catch {
    return null;
  }
}

function publishableFromDomain(domain) {
  // Clerk 用 base64url（无 padding），不是标准 base64
  return `pk_test_${Buffer.from(`${domain}$`).toString("base64url")}`;
}

(async () => {
  const secret = (process.argv[2] || "").trim();
  let domain = (process.argv[3] || "").trim();

  if (!secret || !secret.startsWith("sk_")) {
    console.error("需要一个有效的 secret key。");
    console.error("用法：node scripts/switch-clerk-instance.js sk_test_xxxx [dashing-prawn-4703]");
    process.exit(1);
  }

  // 1. 验证 key
  const inst = await apiGet("https://api.clerk.com/v1/instance", secret);
  if (inst.status !== 200) {
    console.error("❌ 这个 secret key 无效：", JSON.stringify(inst.body).slice(0, 200));
    process.exit(1);
  }
  console.log(`✅ secret key 有效 → 实例 ${inst.body.id}（${inst.body.environment_type}）`);

  // 2. 确定前端域名
  if (!domain) {
    // 从现有 .env.local 的 publishable key 反推
    const raw0 = fs.readFileSync(ENV, "utf8");
    const m0 = raw0.match(/^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=(.*)$/m);
    const guess = m0 ? domainFromPublishable(m0[1].trim()) : null;
    // 反推出来的可能是旧实例的域名，保留作为参考但仍需用户确认
    if (guess) console.log(`   现有 .env.local 指向 ${guess}`);
    console.error("❌ 请在命令后补上你的前端域名，例如：");
    console.error(`   node scripts/switch-clerk-instance.js ${secret.slice(0, 12)}... dashing-prawn-4703`);
    process.exit(1);
  }

  const fapi = `https://${domain}.clerk.accounts.dev`;
  const publishable = publishableFromDomain(`${domain}.clerk.accounts.dev`);

  // 3. 读这个实例的社交连接，确认域名对得上
  const env = await apiGet(`${fapi}/v1/environment`, secret);
  const social = Object.keys(env.body?.user_settings?.social ?? {});
  const appName = env.body?.display_config?.application_name;
  const authId = env.body?.auth_config?.id ?? "(读不到，域名可能不对)";
  console.log(`   前端 API：${fapi}`);
  console.log(`   实例 auth id：${authId}`);
  console.log(`   应用名：${appName}`);
  console.log(`   社交连接：${social.join(", ") || "(无)"}`);

  if (!social.includes("oauth_github")) {
    console.warn("⚠️  这个实例没有 GitHub。先确认域名对不对，再去 Dashboard 启用。");
  }

  // 4. 备份并写入
  const backup = `${ENV}.bak-${new Date().toISOString().slice(0, 10)}`;
  fs.copyFileSync(ENV, backup);
  const raw = fs.readFileSync(ENV, "utf8");
  const next = raw
    .replace(/^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=.*$/m, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${publishable}`)
    .replace(/^CLERK_SECRET_KEY=.*$/m, `CLERK_SECRET_KEY=${secret}`);
  fs.writeFileSync(ENV, next, "utf8");

  console.log(`\n✅ .env.local 已更新（原文件备份为 ${path.basename(backup)}）`);
  console.log(`   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${publishable}`);
  console.log("   CLERK_SECRET_KEY=<已写入>");
  console.log("\n下一步：重启 dev server（Ctrl+C 后 npm run dev），然后跑端到端验证。");
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
