/**
 * Client-side helper for invoking the sms.ir OTP and Cloudflare D1 registration endpoints
 */

export interface VerifyOtpParams {
  mobile: string;
  code: string;
  fullName?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

export interface VerifyOtpResponse {
  success: boolean;
  message: string;
  user?: {
    id: string;
    phone: string;
    full_name: string;
    role: string;
    city: string;
    province: string;
    email?: string;
  };
  member?: {
    id: string;
    auth_user_id: string;
    full_name: string;
    phone: string;
    role: string;
    city: string;
    province: string;
  };
  roles?: string[];
  sessionToken?: string;
}

export async function requestSmsOtp(mobile: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("/api/sms/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile }),
      keepalive: true,
      signal: AbortSignal.timeout(6000),
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
  params: string | VerifyOtpParams,
  optionalCode?: string,
): Promise<VerifyOtpResponse> {
  const payload: VerifyOtpParams =
    typeof params === "string"
      ? { mobile: params, code: optionalCode || "" }
      : params;

  try {
    const res = await fetch("/api/sms/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as VerifyOtpResponse;

    if (data.success && data.sessionToken && typeof window !== "undefined") {
      // Save D1 session in localStorage and cookie
      const sessionData = {
        token: data.sessionToken,
        user: data.user,
        member: data.member,
        roles: data.roles || ["buyer"],
      };
      localStorage.setItem("terrabar_d1_session", JSON.stringify(sessionData));
      document.cookie = `tb_session=${data.sessionToken}; path=/; max-age=2592000; SameSite=Lax`;
      window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: sessionData }));
    }

    return {
      success: !!data.success,
      message: data.message || (res.ok ? "ورود با موفقیت انجام شد." : "کد نامعتبر است."),
      user: data.user,
      member: data.member,
      roles: data.roles,
      sessionToken: data.sessionToken,
    };
  } catch (err) {
    console.error("[submitVerifySmsOtp error]", err);
    return {
      success: false,
      message: "خطا در ارتباط با سرور جهت تأیید کد و ثبت‌نام.",
    };
  }
}
