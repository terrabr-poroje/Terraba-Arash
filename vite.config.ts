/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

function smsDevApiPlugin(): Plugin {
  return {
    name: "sms-ir-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method === "POST" && req.url === "/api/sms/send-otp") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", async () => {
            try {
              const { mobile } = JSON.parse(body || "{}");
              const { sendOtpSms } = (await server.ssrLoadModule("./src/lib/sms-service.ts")) as {
                sendOtpSms: (m: string) => Promise<{ success: boolean; message: string }>;
              };
              const result = await sendOtpSms(mobile);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = result.success ? 200 : 400;
              res.end(JSON.stringify(result));
            } catch (err) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, message: "خطای سرور در ارسال پیامک" }));
            }
          });
          return;
        }

        if (req.method === "POST" && req.url === "/api/sms/verify-otp") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", async () => {
            try {
              const parsed = JSON.parse(body || "{}");
              const { verifyOtpCode } = (await server.ssrLoadModule("./src/lib/sms-service.ts")) as {
                verifyOtpCode: (m: string, c: string) => { success: boolean; message: string };
              };
              const { registerOrLoginUserWithPhone } = (await server.ssrLoadModule("./src/lib/d1-database.ts")) as {
                registerOrLoginUserWithPhone: (p: any) => Promise<any>;
              };

              const result = verifyOtpCode(parsed.mobile, parsed.code);
              if (!result.success) {
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.statusCode = 400;
                res.end(JSON.stringify(result));
                return;
              }

              const authResult = await registerOrLoginUserWithPhone({
                phone: parsed.mobile,
                fullName: parsed.fullName,
                city: parsed.city,
                province: parsed.province,
                role: parsed.role,
                activity: parsed.activity,
              });

              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Set-Cookie", `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`);
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  message: "کد تأیید شد و کاربر با موفقیت در دیتابیس D1 ذخیره شد.",
                  user: authResult.user,
                  member: authResult.member,
                  roles: authResult.roles,
                  sessionToken: authResult.sessionToken,
                }),
              );
            } catch (err) {
              console.error("[dev verify-otp exception]", err);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, message: "خطای سرور در تأیید کد و ثبت‌نام در دیتابیس" }));
            }
          });
          return;
        }

        if (req.method === "GET" && req.url === "/api/auth/session") {
          try {
            const authHeader = (req.headers["authorization"] as string) || "";
            const cookieHeader = (req.headers["cookie"] as string) || "";
            let token = authHeader.replace(/^Bearer\s+/i, "").trim();

            if (!token && cookieHeader.includes("tb_session=")) {
              const match = cookieHeader.match(/tb_session=([^;]+)/);
              if (match) token = match[1];
            }

            const { validateD1Session } = (await server.ssrLoadModule("./src/lib/d1-database.ts")) as {
              validateD1Session: (t: string) => Promise<any>;
            };
            const session = await validateD1Session(token);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.statusCode = 200;
            res.end(JSON.stringify({ session }));
          } catch (err) {
            console.error("[dev /api/auth/session error]", err);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.statusCode = 200;
            res.end(JSON.stringify({ session: null }));
          }
          return;
        }

        if (req.method === "POST" && req.url === "/api/auth/logout") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", async () => {
            try {
              const { token } = JSON.parse(body || "{}");
              const { invalidateD1Session } = (await server.ssrLoadModule("./src/lib/d1-database.ts")) as {
                invalidateD1Session: (t: string) => Promise<void>;
              };
              if (token) await invalidateD1Session(token);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Set-Cookie", "tb_session=; Path=/; Max-Age=0; SameSite=Lax");
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [smsDevApiPlugin()],
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      cors: true,
      hmr: process.env.DISABLE_HMR !== "true",
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
  },
  tanstackStart: {
    tsr: { autoCodeSplitting: true },
    server: { entry: "server" },
  },
});
