/* eslint-disable @typescript-eslint/no-explicit-any */
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { sendOtpSms, verifyOtpCode } from "./lib/sms-service";
import {
  setCloudflareD1Binding,
  registerOrLoginUserWithPhone,
  validateD1Session,
  invalidateD1Session,
} from "./lib/d1-database";

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

      // Handle sms.ir OTP send endpoint
      if (url.pathname === "/api/sms/send-otp" && request.method === "POST") {
        try {
          const body = (await request.json().catch(() => ({}))) as { mobile?: string };
          const result = await sendOtpSms(body?.mobile || "");
          return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        } catch {
          return new Response(JSON.stringify({ success: false, message: "خطای سرور در ارسال پیامک" }), {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
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
              message: "کد تأیید شد و کاربر با موفقیت در دیتابیس D1 ذخیره شد.",
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
          return new Response(JSON.stringify({ success: false, message: "خطای سرور در تأیید کد و ثبت‌نام در دیتابیس" }), {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
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
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        } catch {
          return new Response(JSON.stringify({ session: null }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
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

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
