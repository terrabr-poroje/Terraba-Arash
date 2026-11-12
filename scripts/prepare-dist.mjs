import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, ".output");
const outputPublicDir = path.join(outputDir, "public");
const outputServerDir = path.join(outputDir, "server");
const distDir = path.join(rootDir, "dist");

console.log("[prepare-dist] Starting build artifact preparation for deployment...");

// 1. Verify .output exists
if (!fs.existsSync(outputDir)) {
  console.error("[prepare-dist] Error: .output directory not found. Please run vite build first.");
  process.exit(1);
}

// 2. Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 3. Helper to recursively copy directories
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 4. Copy all public assets to dist/
if (fs.existsSync(outputPublicDir)) {
  console.log(`[prepare-dist] Copying client assets from ${outputPublicDir} to ${distDir}...`);
  copyDirSync(outputPublicDir, distDir);
} else {
  console.warn("[prepare-dist] Warning: .output/public not found.");
}

// 5. Copy server bundle to dist/server
if (fs.existsSync(outputServerDir)) {
  console.log(`[prepare-dist] Copying server bundle to ${path.join(distDir, "server")}...`);
  copyDirSync(outputServerDir, path.join(distDir, "server"));
}

// 6. Copy nitro metadata
const nitroJson = path.join(outputDir, "nitro.json");
if (fs.existsSync(nitroJson)) {
  fs.copyFileSync(nitroJson, path.join(distDir, "nitro.json"));
}

// 7. Find assets for index.html injection
const distAssetsDir = path.join(distDir, "assets");
let mainJsFile = "";
let mainCssFile = "";

if (fs.existsSync(distAssetsDir)) {
  const assetFiles = fs.readdirSync(distAssetsDir);
  for (const file of assetFiles) {
    if (file.startsWith("index-") && file.endsWith(".js")) {
      mainJsFile = `/assets/${file}`;
    }
    if (file.startsWith("styles-") && file.endsWith(".css")) {
      mainCssFile = `/assets/${file}`;
    }
  }
  // Fallbacks if prefixed names differ
  if (!mainJsFile) {
    const jsCandidate = assetFiles.find((f) => f.endsWith(".js"));
    if (jsCandidate) mainJsFile = `/assets/${jsCandidate}`;
  }
  if (!mainCssFile) {
    const cssCandidate = assetFiles.find((f) => f.endsWith(".css"));
    if (cssCandidate) mainCssFile = `/assets/${cssCandidate}`;
  }
}

console.log(`[prepare-dist] Detected main JS: ${mainJsFile}, main CSS: ${mainCssFile}`);

// 8. Generate production index.html
const indexHtmlContent = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5" />
    <meta name="theme-color" content="#1e704b" />
    <meta name="format-detection" content="telephone=no" />
    <title>ترابار | بازار میوه و تره‌بار ایران</title>
    <meta name="description" content="ترابار؛ بستری برای ارتباط باغدار، کشاورز، تأمین‌کننده، بارفروش و خریدار، معرفی بار و پیدا کردن محصولات بازار میوه و تره‌بار ایران." />
    <meta property="og:title" content="ترابار | بازار میوه و تره‌بار ایران" />
    <meta property="og:description" content="ارتباط فعالان بازار میوه و تره‌بار ایران برای معرفی بار و پیدا کردن محصول موردنیاز." />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="alternate icon" href="/favicon.ico" type="image/x-icon" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="preload" href="/fonts/vazirmatn/Vazirmatn-Variable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
    ${mainCssFile ? `<link rel="stylesheet" href="${mainCssFile}" />` : ""}
    <script>
      (function() {
        try {
          if (typeof globalThis === 'undefined') {
            if (typeof window !== 'undefined') window.globalThis = window;
            else if (typeof self !== 'undefined') self.globalThis = self;
          }
          if (typeof window !== 'undefined') {
            var c = window.crypto || window.msCrypto;
            if (!c) {
              try {
                c = {};
                Object.defineProperty(window, 'crypto', { value: c, writable: true, configurable: true });
              } catch(e) {}
            }
            if (window.history) {
              var p = window.history.pushState;
              if (p) window.history.pushState = function() { try { return p.apply(window.history, arguments); } catch(e) {} };
              var r = window.history.replaceState;
              if (r) window.history.replaceState = function() { try { return r.apply(window.history, arguments); } catch(e) {} };
            }
          }
        } catch(e) {}
      })();
    </script>
  </head>
  <body>
    <noscript>
      <div style="padding:16px;background-color:#fff3cd;color:#856404;text-align:center;font-family:Tahoma,sans-serif;">
        برای مشاهده کامل سامانه ترابار، لطفاً جاوااسکریپت مرورگر خود را فعال کنید.
      </div>
    </noscript>
    <div id="root"></div>
    ${mainJsFile ? `<script type="module" src="${mainJsFile}"></script>` : ""}
  </body>
</html>`;

const indexPath = path.join(distDir, "index.html");
fs.writeFileSync(indexPath, indexHtmlContent, "utf8");

// Also create 200.html and 404.html for SPA routers
fs.writeFileSync(path.join(distDir, "200.html"), indexHtmlContent, "utf8");
fs.writeFileSync(path.join(distDir, "404.html"), indexHtmlContent, "utf8");

// 9. Count and report generated files in dist/
function countFiles(dir) {
  let count = 0;
  let totalBytes = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countFiles(full);
      count += sub.count;
      totalBytes += sub.totalBytes;
    } else {
      count++;
      totalBytes += fs.statSync(full).size;
    }
  }
  return { count, totalBytes };
}

const stats = countFiles(distDir);
console.log(`[prepare-dist] Build artifacts successfully prepared in ${distDir}`);
console.log(`[prepare-dist] Total files: ${stats.count}, Total size: ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`);
