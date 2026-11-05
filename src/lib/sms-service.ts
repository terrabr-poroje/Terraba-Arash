/**
 * Service for sending and verifying OTP SMS via sms.ir REST API
 * Template: 123456 ("کد تایید شما: #CODE#")
 */

const SMS_IR_API_KEY =
  process.env.SMS_IR_API_KEY || "IccKEnd8XHsrah8B0ZuhR7exhuC5rzrB9PGEFpjcrJW2occX";
const SMS_IR_TEMPLATE_ID = Number(process.env.SMS_IR_TEMPLATE_ID || 123456);

// In-memory OTP storage: normalizedMobile -> { code, expiresAt, attempts }
type StoredOtp = {
  code: string;
  expiresAt: number;
  attempts: number;
};

// Global map surviving hot reloads in dev
const globalForOtp = globalThis as unknown as { __terrabar_otp_store__?: Map<string, StoredOtp> };
export const otpStore = globalForOtp.__terrabar_otp_store__ || new Map<string, StoredOtp>();
globalForOtp.__terrabar_otp_store__ = otpStore;

export function normalizeIranMobile(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.startsWith("0098")) return "0" + digits.slice(4);
  if (digits.startsWith("98") && digits.length >= 12) return "0" + digits.slice(2);
  if (digits.startsWith("9") && digits.length === 10) return "0" + digits;
  if (digits.startsWith("09")) return digits;
  return digits;
}

export function generateOtpCode(): string {
  // Generate cryptographically secure or pseudo-random 6-digit code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtpSms(rawMobile: string): Promise<{ success: boolean; message: string; code?: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  if (!/^09\d{9}$/.test(mobile)) {
    return { success: false, message: "شماره موبایل وارد شده معتبر نیست. لطفاً یک شماره ۱۱ رقمی (مثال: ۰۹۱۲۳۴۵۶۷۸۹) وارد کنید." };
  }

  // Rate limiting: allow resend only after 60 seconds
  const existing = otpStore.get(mobile);
  const now = Date.now();
  if (existing && existing.expiresAt - now > 120000) { // Sent less than 60s ago (180s total ttl)
    const waitSec = Math.ceil((existing.expiresAt - 120000 - now) / 1000);
    if (waitSec > 0) {
      return { success: false, message: `لطفاً ${waitSec} ثانیه دیگر جهت درخواست مجدد کد شکیبا باشید.` };
    }
  }

  const code = generateOtpCode();

  try {
    const payload = {
      mobile,
      templateId: SMS_IR_TEMPLATE_ID,
      parameters: [
        {
          name: "CODE",
          value: code,
        },
      ],
    };

    const response = await fetch("https://api.sms.ir/v1/send/verify", {
      method: "POST",
      headers: {
        "x-api-key": SMS_IR_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
      data?: { messageId?: number; cost?: number };
    };

    if (response.ok && (result.status === 1 || result.status === 200)) {
      // Store code for 3 minutes (180,000 ms)
      otpStore.set(mobile, {
        code,
        expiresAt: now + 180000,
        attempts: 0,
      });

      return {
        success: true,
        message: "کد تأیید با موفقیت از طریق سامانه پیامکی sms.ir ارسال شد.",
      };
    } else {
      const errorDetail = result.message || `خطای سرور پیامک (${response.status})`;
      console.error("[sms.ir API error]", response.status, result);
      return {
        success: false,
        message: `ارسال پیامک از طریق سامانه sms.ir انجام نشد: ${errorDetail}`,
      };
    }
  } catch (err) {
    console.error("[sms.ir fetch exception]", err);
    return {
      success: false,
      message: "خطا در برقراری ارتباط با درگاه پیامک sms.ir. اتصال اینترنت را بررسی کنید.",
    };
  }
}

export function verifyOtpCode(rawMobile: string, inputCode: string): { success: boolean; message: string } {
  const mobile = normalizeIranMobile(rawMobile);
  const cleanCode = inputCode.trim();

  const stored = otpStore.get(mobile);
  if (!stored) {
    return { success: false, message: "کد تأییدی برای این شماره ثبت نشده یا منقضی شده است. لطفاً مجدداً درخواست کد کنید." };
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(mobile);
    return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید دریافت کنید." };
  }

  stored.attempts += 1;
  if (stored.attempts > 5) {
    otpStore.delete(mobile);
    return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کد جدید دریافت کنید." };
  }

  if (stored.code !== cleanCode) {
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  // Verified successfully - remove used code
  otpStore.delete(mobile);
  return { success: true, message: "کد تأیید با موفقیت احراز شد." };
}
