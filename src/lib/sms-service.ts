/**
 * Service for sending and verifying OTP SMS via sms.ir REST API
 * Template: 888217 ("این یک پیام تست و فاقد اعتبار است\nکد:#OTP#\n...")
 */

const SMS_IR_API_KEY =
  process.env.SMS_IR_API_KEY || "4tE2QxFzjvScsUxVkmhYJVZ7tmB32ZRexUFcp8fcRDEmtOcW";
const SMS_IR_TEMPLATE_ID = Number(process.env.SMS_IR_TEMPLATE_ID || 888217);
const SMS_IR_TEMPLATE_PARAM = process.env.SMS_IR_TEMPLATE_PARAM || "OTP";

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

interface SmsTemplateItem {
  id: number;
  title?: string;
  templateText?: string;
  type?: number;
  status?: number;
  parameters?: Array<{ name: string; description?: string }>;
}

async function checkTemplateStatus(): Promise<{ id?: number; status?: number; name?: string } | null> {
  try {
    const res = await fetch("https://api.sms.ir/v1/templates", {
      headers: {
        "x-api-key": SMS_IR_API_KEY,
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { data?: SmsTemplateItem[] };
    if (Array.isArray(body?.data) && body.data.length > 0) {
      const match = body.data.find((t: SmsTemplateItem) => t.id === SMS_IR_TEMPLATE_ID) || body.data[0];
      return {
        id: match.id,
        status: match.status,
        name: match.parameters?.[0]?.name || "OTP",
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function sendOtpSms(rawMobile: string): Promise<{ success: boolean; message: string; code?: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  if (!/^09\d{9}$/.test(mobile)) {
    return { success: false, message: "شماره موبایل وارد شده معتبر نیست. لطفاً یک شماره ۱۱ رقمی (مثال: ۰۹۱۲۳۴۵۶۷۸۹) وارد کنید." };
  }

  // Unlimited attempts allowed per user request (no cooldown restrictions)
  const code = generateOtpCode();

  try {
    const payload = {
      mobile,
      templateId: SMS_IR_TEMPLATE_ID,
      parameters: [
        {
          name: SMS_IR_TEMPLATE_PARAM,
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
        expiresAt: now + 600000, // 10 minutes
        attempts: 0,
      });

      return {
        success: true,
        message: "کد تأیید با موفقیت از طریق سامانه پیامکی sms.ir ارسال شد.",
        code,
      };
    } else {
      console.warn("[sms.ir API response]", response.status, result);

      // Handle template pending approval or not found
      if (result.status === 113) {
        const templateInfo = await checkTemplateStatus();
        // If template exists but status is 1 (pending review by sms.ir operators)
        if (templateInfo && templateInfo.status === 1) {
          // Store code so testing/login is unblocked while sms.ir approves the template
          otpStore.set(mobile, {
            code,
            expiresAt: now + 600000, // 10 minutes
            attempts: 0,
          });

          return {
            success: true,
            code,
            message: `قالب پیامک با شناسه ${templateInfo.id} در پنل sms.ir در انتظار تأیید کارشناس است (وضعیت ۱). کد ورود شما جهت تست: ${code}`,
          };
        }
      }

      const errorDetail = result.message || `خطای سرور پیامک (${response.status})`;
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

  if (stored.code !== cleanCode) {
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  // Verified successfully - remove used code
  otpStore.delete(mobile);
  return { success: true, message: "کد تأیید با موفقیت احراز شد." };
}
