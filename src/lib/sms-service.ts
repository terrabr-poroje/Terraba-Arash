/**
 * Durable OTP service for sms.ir using Cloudflare D1.
 * OTP values are stored as salted SHA-256 hashes and consumed atomically.
 */

import { getD1 } from "./d1-database";

type SmsEnvironment = {
  SMS_IR_API_KEY?: string;
  SMS_IR_TEMPLATE_ID?: string;
};

type OtpRow = {
  code_hash: string;
  salt: string;
  expires_at: number;
  attempts: number;
};

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SMS_IR_FALLBACK_TEMPLATE_ID = 888217;

export function normalizeIranMobile(value: string): string {
  const digits = normalizeDigits(value).replace(/[^\d]/g, "");
  if (digits.startsWith("0098")) return "0" + digits.slice(4);
  if (digits.startsWith("98") && digits.length >= 12) return "0" + digits.slice(2);
  if (digits.startsWith("9") && digits.length === 10) return "0" + digits;
  if (digits.startsWith("09")) return digits;
  return digits;
}

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
    if (persian >= 0) return String(persian);
    const arabic = "٠١٢٣٤٥٦٧٨٩".indexOf(digit);
    return arabic >= 0 ? String(arabic) : digit;
  });
}

export function generateOtpCode(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(100000 + (random[0] % 900000));
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashOtpCode(mobile: string, salt: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${mobile}:${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureOtpTable(): Promise<void> {
  await getD1().exec(`
    CREATE TABLE IF NOT EXISTS terrabar_otp_codes (
      mobile TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
}

async function sendToSmsIr(
  mobile: string,
  templateId: number,
  code: string,
  apiKey: string,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  try {
    const response = await fetch("https://api.sms.ir/v1/send/verify", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        mobile,
        templateId,
        parameters: [
          { name: "Code", value: code },
          { name: "OTP", value: code },
          { name: "code", value: code },
        ],
      }),
      signal: AbortSignal.timeout(3500),
    });

    const result = (await response.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
      data?: { messageId?: number };
    };

    return {
      ok: response.ok && (result.status === 1 || typeof result.data?.messageId === "number"),
      status: result.status,
      message: result.message,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: error instanceof Error && error.name === "TimeoutError" ? "مهلت ارتباط با درگاه پیامک تمام شد" : message };
  }
}

export async function sendOtpSms(
  rawMobile: string,
  env: SmsEnvironment,
): Promise<{ success: boolean; message: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  if (!/^09\d{9}$/.test(mobile)) {
    return { success: false, message: "شماره موبایل وارد شده معتبر نیست. لطفاً شماره ۱۱ رقمی وارد کنید." };
  }

  const apiKey = env.SMS_IR_API_KEY?.trim();
  if (!apiKey) {
    console.error("[sms-otp] Missing Worker secret SMS_IR_API_KEY");
    return { success: false, message: "تنظیمات سرویس پیامک کامل نیست. لطفاً با پشتیبانی تماس بگیرید." };
  }

  await ensureOtpTable();

  const code = generateOtpCode();
  const salt = randomHex(16);
  const codeHash = await hashOtpCode(mobile, salt, code);
  const now = Date.now();

  // Persist the challenge before sending so any Worker instance can verify it.
  await getD1()
    .prepare(`INSERT INTO terrabar_otp_codes (mobile, code_hash, salt, expires_at, attempts, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(mobile) DO UPDATE SET
        code_hash = excluded.code_hash,
        salt = excluded.salt,
        expires_at = excluded.expires_at,
        attempts = 0,
        created_at = excluded.created_at`)
    .bind(mobile, codeHash, salt, now + OTP_TTL_MS, now)
    .run();

  const configuredTemplateId = Number(env.SMS_IR_TEMPLATE_ID || 582256);
  const primary = await sendToSmsIr(mobile, configuredTemplateId, code, apiKey);
  if (primary.ok) {
    return { success: true, message: "کد تأیید با موفقیت از طریق پیامک ارسال شد." };
  }

  let fallback: { ok: boolean; status?: number; message?: string } = { ok: false };
  if (configuredTemplateId !== SMS_IR_FALLBACK_TEMPLATE_ID) {
    fallback = await sendToSmsIr(mobile, SMS_IR_FALLBACK_TEMPLATE_ID, code, apiKey);
    if (fallback.ok) {
      return { success: true, message: "کد تأیید با موفقیت از طریق پیامک ارسال شد." };
    }
  }

  // Do not leave an active challenge when the gateway rejected both sends.
  await getD1()
    .prepare("DELETE FROM terrabar_otp_codes WHERE mobile = ? AND code_hash = ?")
    .bind(mobile, codeHash)
    .run();

  console.error("[sms-otp] Both SMS templates failed", {
    primaryStatus: primary.status,
    primaryMessage: primary.message,
    fallbackStatus: fallback.status,
    fallbackMessage: fallback.message,
  });
  return { success: false, message: "ارسال پیامک ناموفق بود. چند لحظه بعد دوباره تلاش کنید." };
}

export async function verifyOtpCode(
  rawMobile: string,
  inputCode: string,
): Promise<{ success: boolean; message: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  const cleanCode = normalizeDigits(inputCode).replace(/\s/g, "");

  if (!/^09\d{9}$/.test(mobile) || !/^\d{6}$/.test(cleanCode)) {
    return { success: false, message: "شماره یا کد تأیید معتبر نیست." };
  }

  await ensureOtpTable();
  const db = getD1();
  const now = Date.now();

  const stored = await db
    .prepare("SELECT code_hash, salt, expires_at, attempts FROM terrabar_otp_codes WHERE mobile = ? LIMIT 1")
    .bind(mobile)
    .first<OtpRow>();

  if (!stored) {
    return { success: false, message: "کد تأییدی برای این شماره ثبت نشده است. لطفاً کد جدید دریافت کنید." };
  }

  if (now > stored.expires_at) {
    await db.prepare("DELETE FROM terrabar_otp_codes WHERE mobile = ?").bind(mobile).run();
    return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید دریافت کنید." };
  }

  if (stored.attempts >= OTP_MAX_ATTEMPTS) {
    await db.prepare("DELETE FROM terrabar_otp_codes WHERE mobile = ?").bind(mobile).run();
    return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کد جدید دریافت کنید." };
  }

  const submittedHash = await hashOtpCode(mobile, stored.salt, cleanCode);
  if (submittedHash !== stored.code_hash) {
    await db
      .prepare("UPDATE terrabar_otp_codes SET attempts = attempts + 1 WHERE mobile = ? AND code_hash = ? AND attempts < ?")
      .bind(mobile, stored.code_hash, OTP_MAX_ATTEMPTS)
      .run();

    const updated = await db
      .prepare("SELECT attempts FROM terrabar_otp_codes WHERE mobile = ? LIMIT 1")
      .bind(mobile)
      .first<{ attempts: number }>();

    if (updated && updated.attempts >= OTP_MAX_ATTEMPTS) {
      await db.prepare("DELETE FROM terrabar_otp_codes WHERE mobile = ?").bind(mobile).run();
      return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کد جدید دریافت کنید." };
    }
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  // DELETE ... RETURNING makes a code single-use even if two Worker instances verify concurrently.
  const consumed = await db
    .prepare(`DELETE FROM terrabar_otp_codes
      WHERE mobile = ? AND code_hash = ? AND expires_at >= ? AND attempts < ?
      RETURNING mobile`)
    .bind(mobile, stored.code_hash, now, OTP_MAX_ATTEMPTS)
    .first<{ mobile: string }>();

  if (!consumed) {
    return { success: false, message: "کد قبلاً استفاده شده یا منقضی شده است. لطفاً کد جدید دریافت کنید." };
  }

  return { success: true, message: "کد تأیید با موفقیت احراز شد." };
}
