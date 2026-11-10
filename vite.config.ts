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
              res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
              res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
              res.setHeader("Set-Cookie", `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`);
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  message: "ورود با موفقیت انجام شد.",
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
              res.end(JSON.stringify({ success: false, message: "خطای سرور در تأیید کد و ورود" }));
            }
          });
          return;
        }

        // Handle Email authentication in dev
        if (req.method === "POST" && req.url === "/api/auth/email-login") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", async () => {
            try {
              const parsed = JSON.parse(body || "{}");
              const { registerOrLoginUserWithEmail } = (await server.ssrLoadModule("./src/lib/d1-database.ts")) as {
                registerOrLoginUserWithEmail: (p: any) => Promise<any>;
              };

              const email = (parsed.email || "").trim().toLowerCase();
              if (!email || !email.includes("@")) {
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, message: "نشانی ایمیل معتبر نیست." }));
                return;
              }

              const authResult = await registerOrLoginUserWithEmail({
                email,
                password: parsed.password,
                fullName: parsed.fullName,
                phone: parsed.phone,
                city: parsed.city,
                province: parsed.province,
                role: parsed.role,
                activity: parsed.activity,
                mode: parsed.mode,
              });

              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Set-Cookie", `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`);
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  message: "ورود با موفقیت انجام شد.",
                  user: authResult.user,
                  member: authResult.member,
                  roles: authResult.roles,
                  sessionToken: authResult.sessionToken,
                }),
              );
            } catch (err: any) {
              console.error("[dev email-login error]", err);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 400;
              res.end(JSON.stringify({ success: false, message: err?.message || "خطا در ورود با ایمیل" }));
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
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            res.statusCode = 200;
            res.end(JSON.stringify({ session }));
          } catch (err) {
            console.error("[dev /api/auth/session error]", err);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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

        // Handle ParsPack upload in dev
        if (req.method === "POST" && req.url === "/api/storage/upload") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          req.on("end", async () => {
            try {
              const fullBuffer = Buffer.concat(chunks);
              const contentType = req.headers["content-type"] || "";

              let fileBuffer: Buffer = fullBuffer;
              let customKey: string | null = null;
              let folder = "uploads";

              // Simple multipart boundary parsing
              if (contentType.includes("multipart/form-data")) {
                const boundary = contentType.split("boundary=")[1]?.trim();
                if (boundary) {
                  const parts = fullBuffer.toString("binary").split(`--${boundary}`);
                  for (const part of parts) {
                    if (part.includes('name="key"')) {
                      const match = part.split("\r\n\r\n")[1]?.split("\r\n")[0]?.trim();
                      if (match) customKey = match;
                    }
                    if (part.includes('name="folder"')) {
                      const match = part.split("\r\n\r\n")[1]?.split("\r\n")[0]?.trim();
                      if (match) folder = match;
                    }
                    if (part.includes('name="file"')) {
                      const headerEndIndex = part.indexOf("\r\n\r\n");
                      if (headerEndIndex !== -1) {
                        const fileBinary = part.substring(headerEndIndex + 4, part.length - 2);
                        fileBuffer = Buffer.from(fileBinary, "binary");
                      }
                    }
                  }
                }
              }

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

              const { uploadToParsPack } = (await server.ssrLoadModule("./src/lib/parspack-storage.ts")) as {
                uploadToParsPack: (k: string, b: Buffer, ct?: string) => Promise<{ key: string; url: string; success: boolean }>;
              };

              const uploadResult = await uploadToParsPack(key, fileBuffer, "image/webp");

              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  fileKey: uploadResult.key,
                  url: uploadResult.url,
                  size: fileBuffer.length,
                  contentType: "image/webp",
                  message: "فایل با موفقیت با فرمت WebP در فضای ابری پارس‌پک ذخیره شد.",
                }),
              );
            } catch (err: any) {
              console.error("[dev storage upload error]", err);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, message: `خطا در بارگذاری: ${err?.message || err}` }));
            }
          });
          return;
        }

        // Handle ParsPack delete in dev
        if (req.method === "POST" && req.url === "/api/storage/delete") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", async () => {
            try {
              const { key } = JSON.parse(body || "{}");
              if (!key) {
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, message: "شناسه فایل مشخص نشده است." }));
                return;
              }

              const { deleteFromParsPack } = (await server.ssrLoadModule("./src/lib/parspack-storage.ts")) as {
                deleteFromParsPack: (k: string) => Promise<{ success: boolean; message: string }>;
              };

              const deleteResult = await deleteFromParsPack(key);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 200;
              res.end(JSON.stringify(deleteResult));
            } catch (err: any) {
              console.error("[dev storage delete error]", err);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, message: `خطا در حذف: ${err?.message || err}` }));
            }
          });
          return;
        }

        // Handle ParsPack file proxy serving in dev
        if (req.method === "GET" && req.url?.startsWith("/api/storage/file/")) {
          const fileKey = req.url.replace(/^\/api\/storage\/file\//, "").split("?")[0];
          try {
            const { getFileFromParsPack } = (await server.ssrLoadModule("./src/lib/parspack-storage.ts")) as {
              getFileFromParsPack: (k: string) => Promise<any>;
            };
            const fileData = await getFileFromParsPack(fileKey);
            if (!fileData || !fileData.stream) {
              res.statusCode = 404;
              res.end("File not found");
              return;
            }

            res.setHeader("Content-Type", fileData.contentType || "image/webp");
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            if (fileData.contentLength) {
              res.setHeader("Content-Length", String(fileData.contentLength));
            }

            fileData.stream.pipe(res);
          } catch (err) {
            console.error("[dev storage serve error]", fileKey, err);
            res.statusCode = 500;
            res.end("Error fetching file");
          }
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
      hmr: false,
      watch: null,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    },
    build: {
      target: ["es2018", "chrome65", "edge18", "firefox65", "safari12"],
      cssTarget: ["chrome61", "firefox60", "safari11", "edge18"],
    },
    esbuild: {
      target: "es2018",
    },
  },
  tanstackStart: {
    tsr: { autoCodeSplitting: true },
    server: { entry: "server" },
  },
});
