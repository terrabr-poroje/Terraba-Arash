/**
 * Client-side helper for invoking the sms.ir OTP endpoints
 */

export async function requestSmsOtp(mobile: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("/api/sms/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    return {
      success: !!data.success,
      message: data.message || (res.ok ? "کد یک‌بارمصرف پیامک شد." : "خطا در ارسال پیامک"),
    };
  } catch (err) {
    console.error("[requestSmsOtp error]", err);
    return {
      success: false,
      message: "خطا در اتصال به سرور جهت ارسال پیامک. لطفاً اتصال اینترنت خود را بررسی کنید.",
    };
  }
}

export async function submitVerifySmsOtp(
  mobile: string,
  code: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("/api/sms/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, code }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    return {
      success: !!data.success,
      message: data.message || (res.ok ? "کد تأیید شد." : "کد نامعتبر است."),
    };
  } catch (err) {
    console.error("[submitVerifySmsOtp error]", err);
    return {
      success: false,
      message: "خطا در ارتباط با سرور جهت تأیید کد.",
    };
  }
}
