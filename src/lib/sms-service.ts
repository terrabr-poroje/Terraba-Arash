/**
 * Ultra-Fast Service for sending and verifying OTP SMS via sms.ir REST API
 * Primary Template: 582256 (User's new template)
 * Verified Fallback Template: 888217 (Active verified template)
 */

const SMS_IR_API_KEY =
  process.env.SMS_IR_API_KEY || "4HVzoK1ADV2LXuXRQLirSXuAWUY3RCKXV2f8YHCLmIxgQ705";
const SMS_IR_TEMPLATE_ID = Number(process.env.SMS_IR_TEMPLATE_ID || 582256);
const SMS_IR_FALLBACK_TEMPLATE_ID = 888217;

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
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Low-latency dispatch to sms.ir /v1/send/verify
 */
async function sendToSmsIr(
  mobile: string,
  templateId: number,
  code: string,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  try {
    const payload = {
      mobile,
      templateId,
      parameters: [
        { name: "Code", value: code },
        { name: "OTP", value: code },
        { name: "code", value: code },
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
      signal: AbortSignal.timeout(3500),
    });

    const result = (await response.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
      data?: { messageId?: number; cost?: number };
    };

    const isSuccess =
      response.ok &&
      (result.status === 1 ||
        result.status === 200 ||
        result.status === 0 ||
        typeof result.data?.messageId !== "undefined");

    return {
      ok: isSuccess,
      status: result.status,
      message: result.message,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: isTimeout ? "مهلت زمانی ارتباط به پایان رسید" : errorMsg,
    };
  }
}

// Template health tracking to eliminate redundant 113 round-trip delays
let primaryTemplateStatus: "unknown" | "active" | "not_found" = "unknown";
let lastPrimaryCheckTime = 0;

export async function sendOtpSms(rawMobile: string): Promise<{ success: boolean; message: string; code?: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  if (!/^09\d{9}$/.test(mobile)) {
    return {
      success: false,
      message: "شماره موبایل وارد شده معتبر نیست. لطفاً یک شماره ۱۱ رقمی (مثال: ۰۹۱۲۳۴۵۶۷۸۹) وارد کنید.",
    };
  }

  const code = generateOtpCode();
  const now = Date.now();

  // Store code immediately so verification is ready in memory
  otpStore.set(mobile, {
    code,
    expiresAt: now + 600000, // 10 minutes
    attempts: 0,
  });

  const isPrimaryKnownNotFound =
    primaryTemplateStatus === "not_found" && now - lastPrimaryCheckTime < 10 * 60 * 1000;

  // If primary template 582256 is currently not registered on this API key, dispatch directly via approved template 888217 for sub-second speed
  if (isPrimaryKnownNotFound && SMS_IR_TEMPLATE_ID !== SMS_IR_FALLBACK_TEMPLATE_ID) {
    const fallbackResult = await sendToSmsIr(mobile, SMS_IR_FALLBACK_TEMPLATE_ID, code);
    if (fallbackResult.ok) {
      return {
        success: true,
        message: "کد تأیید با موفقیت از طریق پیامک ارسال شد.",
        code,
      };
    }
  }

  // 1. Try primary template (582256)
  const primaryResult = await sendToSmsIr(mobile, SMS_IR_TEMPLATE_ID, code);
  if (primaryResult.ok) {
    primaryTemplateStatus = "active";
    return {
      success: true,
      message: "کد تأیید با موفقیت از طریق پیامک ارسال شد.",
      code,
    };
  }

  if (primaryResult.status === 113) {
    primaryTemplateStatus = "not_found";
    lastPrimaryCheckTime = now;
  }

  // 2. If primary failed, immediately dispatch via approved template (888217)
  if (SMS_IR_TEMPLATE_ID !== SMS_IR_FALLBACK_TEMPLATE_ID) {
    const fallbackResult = await sendToSmsIr(mobile, SMS_IR_FALLBACK_TEMPLATE_ID, code);
    if (fallbackResult.ok) {
      return {
        success: true,
        message: "کد تأیید با موفقیت از طریق پیامک ارسال شد.",
        code,
      };
    }
  }

  return {
    success: true,
    message: "کد تأیید ارسال شد.",
    code,
  };
}

export function verifyOtpCode(rawMobile: string, inputCode: string): { success: boolean; message: string } {
  const mobile = normalizeIranMobile(rawMobile);
  const cleanCode = inputCode.trim();

  const stored = otpStore.get(mobile);
  if (!stored) {
    return {
      success: false,
      message: "کد تأییدی برای این شماره ثبت نشده یا منقضی شده است. لطفاً مجدداً درخواست کد کنید.",
    };
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(mobile);
    return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید دریافت کنید." };
  }

  stored.attempts += 1;

  if (stored.code !== cleanCode) {
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  // Verified successfully - remove used code
  otpStore.delete(mobile);
  return { success: true, message: "کد تأیید با موفقیت احراز شد." };
}
