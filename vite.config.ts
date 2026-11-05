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
              const { mobile, code } = JSON.parse(body || "{}");
              const { verifyOtpCode } = (await server.ssrLoadModule("./src/lib/sms-service.ts")) as {
                verifyOtpCode: (m: string, c: string) => { success: boolean; message: string };
              };
              const result = verifyOtpCode(mobile, code);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = result.success ? 200 : 400;
              res.end(JSON.stringify(result));
            } catch (err) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, message: "خطای سرور در تأیید کد" }));
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
