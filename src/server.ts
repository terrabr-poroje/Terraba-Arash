/* eslint-disable @typescript-eslint/no-explicit-any */
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { sendOtpSms, verifyOtpCode } from "./lib/sms-service";
import {
  setCloudflareD1Binding,
  registerOrLoginUserWithPhone,
  registerOrLoginUserWithEmail,
  validateD1Session,
  invalidateD1Session,
} from "./lib/d1-database";
import {
  uploadToParsPack,
  deleteFromParsPack,
  getFileFromParsPack,
} from "./lib/parspack-storage";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Connect Cloudflare D1 binding from environment
      if (env && (env as any).DB) {
        setCloudflareD1Binding((env as any).DB);
      }

      const url = new URL(request.url);

      // Serve static assets via Cloudflare Workers ASSETS binding if available
      const isStaticAsset =
        url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/fonts/") ||
        url.pathname.startsWith("/_build/") ||
        url.pathname === "/favicon.ico" ||
        url.pathname === "/favicon.svg" ||
        url.pathname === "/apple-touch-icon.png" ||
        url.pathname === "/robots.txt" ||
        url.pathname === "/sitemap.xml" ||
        /\.(js|mjs|css|woff2?|ttf|otf|eot|svg|ico|png|jpe?g|webp|gif|json|xml|txt)$/i.test(url.pathname);

      if (isStaticAsset) {
        if (env && (env as any).ASSETS && typeof (env as any).ASSETS.fetch === "function") {
          try {
            const assetResponse = await (env as any).ASSETS.fetch(request);
            if (assetResponse && assetResponse.status < 400) {
              const headers = new Headers(assetResponse.headers);
              headers.set("Access-Control-Allow-Origin", "*");

              // Guarantee correct MIME types to strictly satisfy Blink/V8 and WebKit requirements
              if (url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")) {
                headers.set("Content-Type", "application/javascript; charset=utf-8");
              } else if (url.pathname.endsWith(".css")) {
                headers.set("Content-Type", "text/css; charset=utf-8");
              } else if (url.pathname.endsWith(".woff2")) {
                headers.set("Content-Type", "font/woff2");
              } else if (url.pathname.endsWith(".svg")) {
                headers.set("Content-Type", "image/svg+xml");
              } else if (url.pathname.endsWith(".webp")) {
                headers.set("Content-Type", "image/webp");
              }

              return new Response(assetResponse.body, {
                status: assetResponse.status,
                headers,
              });
            }
          } catch {
            // Asset fetch exception
          }
        }

        // CRITICAL: NEVER pass static asset requests to SSR!
        // Returning text/html for a script crashes Chrome & Safari with strict MIME checking.
        return new Response("Asset not found", {
          status: 404,
          headers: {
            "content-type": url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")
              ? "application/javascript; charset=utf-8"
              : url.pathname.endsWith(".css")
                ? "text/css; charset=utf-8"
                : "text/plain",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Handle sms.ir OTP send endpoint
      if (url.pathname === "/api/sms/send-otp" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as { mobile?: string };
          const result = await sendOtpSms(body?.mobile || "");
          return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          });
        } catch {
          return new Response(JSON.stringify({ success: false, message: "خطای سرور در ارسال پیامک" }), {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          });
        }
      }

      // Handle sms.ir OTP verification and Cloudflare D1 user registration
      if (url.pathname === "/api/sms/verify-otp" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            mobile?: string;
            code?: string;
            fullName?: string;
            city?: string;
            province?: string;
            role?: string;
            activity?: string;
          };

          const mobile = body?.mobile || "";
          const code = body?.code || "";

          // 1. Verify SMS OTP code
          const verifyResult = verifyOtpCode(mobile, code);
          if (!verifyResult.success) {
            return new Response(JSON.stringify(verifyResult), {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          // 2. Register/login user into Cloudflare D1 database
          const authResult = await registerOrLoginUserWithPhone({
            phone: mobile,
            fullName: body?.fullName,
            city: body?.city,
            province: body?.province,
            role: body?.role,
            activity: body?.activity,
          });

          return new Response(
            JSON.stringify({
              success: true,
              message: "ورود با موفقیت انجام شد.",
              user: authResult.user,
              member: authResult.member,
              roles: authResult.roles,
              sessionToken: authResult.sessionToken,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "Set-Cookie": `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`,
              },
            },
          );
        } catch (e) {
          console.error("[verify-otp exception]", e);
          return new Response(JSON.stringify({ success: false, message: "خطای سرور در تأیید کد و ورود" }), {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
      }

      // Handle Email authentication (login & signup)
      if (url.pathname === "/api/auth/email-login" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            email?: string;
            password?: string;
            fullName?: string;
            phone?: string;
            city?: string;
            province?: string;
            role?: string;
            activity?: string;
            mode?: "login" | "signup";
          };

          const email = body?.email?.trim() || "";
          if (!email || !email.includes("@")) {
            return new Response(JSON.stringify({ success: false, message: "نشانی ایمیل معتبر نیست." }), {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          const authResult = await registerOrLoginUserWithEmail({
            email,
            password: body?.password,
            fullName: body?.fullName,
            phone: body?.phone,
            city: body?.city,
            province: body?.province,
            role: body?.role,
            activity: body?.activity,
            mode: body?.mode,
          });

          return new Response(
            JSON.stringify({
              success: true,
              message: "ورود با موفقیت انجام شد.",
              user: authResult.user,
              member: authResult.member,
              roles: authResult.roles,
              sessionToken: authResult.sessionToken,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "Set-Cookie": `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`,
              },
            },
          );
        } catch (e: any) {
          console.error("[email-login exception]", e);
          return new Response(
            JSON.stringify({ success: false, message: e?.message || "خطا در احراز هویت با ایمیل" }),
            {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        }
      }

      // Handle Admin login with temporary password Amir-112233
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            username?: string;
            password?: string;
          };
          const username = body?.username?.trim() || "";
          const password = body?.password?.trim() || "";

          if (password !== "Amir-112233") {
            return new Response(
              JSON.stringify({ success: false, message: "رمز عبور موقت مدیر نادرست است." }),
              {
                status: 401,
                headers: { "content-type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
              },
            );
          }

          const token = `admin_sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
          const user = {
            id: "admin_user_main",
            phone: "09120000000",
            full_name: username === "admin" ? "مدیر کل ترابار" : username || "مدیر ارشد ترابار",
            role: "admin",
            city: "تهران",
            province: "تهران",
            email: `${username || "admin"}@terrabar.ir`,
          };
          const member = {
            id: "mem_admin_user_main",
            auth_user_id: "admin_user_main",
            full_name: user.full_name,
            phone: user.phone,
            role: "admin",
            city: user.city,
            province: user.province,
          };
          const roles = ["admin", "buyer", "seller", "supplier"];

          return new Response(
            JSON.stringify({
              success: true,
              message: "ورود مدیر با موفقیت تأیید شد.",
              user,
              member,
              roles,
              sessionToken: token,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "Set-Cookie": `tb_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax`,
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        } catch {
          return new Response(
            JSON.stringify({ success: false, message: "خطا در احراز هویت مدیر" }),
            {
              status: 500,
              headers: { "content-type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
            },
          );
        }
      }

      // Handle D1 session validation
      if (url.pathname === "/api/auth/session" && request.method === "GET") {
        try {
          const authHeader = request.headers.get("authorization") || "";
          const cookieHeader = request.headers.get("cookie") || "";
          let token = authHeader.replace(/^Bearer\s+/i, "").trim();

          if (!token && cookieHeader.includes("tb_session=")) {
            const match = cookieHeader.match(/tb_session=([^;]+)/);
            if (match) token = match[1];
          }

          const session = await validateD1Session(token);
          return new Response(JSON.stringify({ session }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          });
        } catch {
          return new Response(JSON.stringify({ session: null }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          });
        }
      }

      // Handle logout
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as { token?: string };
          if (body?.token) {
            await invalidateD1Session(body.token);
          }
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "Set-Cookie": "tb_session=; Path=/; Max-Age=0; SameSite=Lax",
            },
          });
        } catch {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
      }

      // ==========================================
      // ParsPack Object Storage Endpoints
      // ==========================================

      // Upload file to ParsPack Storage
      if (url.pathname === "/api/storage/upload" && request.method === "POST") {
        try {
          const formData = await request.formData();
          const file = formData.get("file") as File | null;
          const folder = (formData.get("folder") as string) || "uploads";
          const customKey = formData.get("key") as string | null;

          if (!file) {
            return new Response(JSON.stringify({ success: false, message: "فایلی جهت بارگذاری ارسال نشده است." }), {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          const arrayBuffer = await file.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);

          // Force WebP extension for all image uploads
          let key: string;
          if (customKey) {
            key = customKey.replace(/\.[^.]+$/, "") + ".webp";
          } else {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const random = Math.random().toString(36).substring(2, 10);
            key = `${folder}/${year}/${month}/${Date.now()}_${random}.webp`;
          }

          const uploadResult = await uploadToParsPack(key, buffer, "image/webp");

          return new Response(
            JSON.stringify({
              success: true,
              fileKey: uploadResult.key,
              url: uploadResult.url,
              size: buffer.byteLength,
              contentType: "image/webp",
              message: "فایل با موفقیت با فرمت WebP در فضای ابری پارس‌پک ذخیره شد.",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        } catch (err: any) {
          console.error("[storage/upload error]", err);
          return new Response(
            JSON.stringify({
              success: false,
              message: `خطا در بارگذاری فایل در فضای ابری پارس‌پک: ${err?.message || err}`,
            }),
            {
              status: 500,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        }
      }

      // Delete file from ParsPack Storage
      if (url.pathname === "/api/storage/delete" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as { key?: string };
          const key = body?.key;

          if (!key) {
            return new Response(JSON.stringify({ success: false, message: "شناسه فایل مشخص نشده است." }), {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          const deleteResult = await deleteFromParsPack(key);
          return new Response(JSON.stringify(deleteResult), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        } catch (err: any) {
          console.error("[storage/delete error]", err);
          return new Response(
            JSON.stringify({
              success: false,
              message: `خطا در حذف فایل از فضای ابری پارس‌پک: ${err?.message || err}`,
            }),
            {
              status: 500,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        }
      }

      // Serve/proxy file from ParsPack Storage
      if (url.pathname.startsWith("/api/storage/file/") && request.method === "GET") {
        const fileKey = url.pathname.replace(/^\/api\/storage\/file\//, "");
        if (!fileKey) {
          return new Response("Not found", { status: 404 });
        }

        try {
          const fileData = await getFileFromParsPack(fileKey);
          if (!fileData || !fileData.stream) {
            return new Response("File not found in storage", { status: 404 });
          }

          const responseHeaders: Record<string, string> = {
            "Content-Type": fileData.contentType || "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          };
          if (fileData.contentLength) {
            responseHeaders["Content-Length"] = String(fileData.contentLength);
          }

          return new Response(fileData.stream, {
            status: 200,
            headers: responseHeaders,
          });
        } catch (err) {
          console.error("[storage/file serve error]", fileKey, err);
          return new Response("Error fetching file from storage", { status: 500 });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);

      // Clean cross-browser headers: remove any X-Frame-Options that blocks preview in Chrome/Safari/Firefox
      const responseHeaders = new Headers(normalized.headers);
      responseHeaders.delete("x-frame-options");
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("X-Content-Type-Options", "nosniff");

      return new Response(normalized.body, {
        status: normalized.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
