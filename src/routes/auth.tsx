import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, Lock, Mail, Phone, ShieldCheck, Sprout, Store, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, signOut, type AppUser, type AppMember } from "@/lib/auth";
import { pageHead, provinces, provinceCities } from "@/lib/marketplace";
import { CityPicker } from "@/components/city-picker";
import { requestSmsOtp, submitVerifySmsOtp } from "@/lib/sms-client";

export const Route = createFileRoute("/auth")({
  head: () =>
    pageHead(
      "ورود و ثبت‌نام",
      "ثبت‌نام و ورود سریع در ترابار؛ ارتباط مستقیم باغداران، تأمین‌کنندگان، بارفروشان و خریداران میوه و تره‌بار.",
    ),
  component: AuthPage,
});

type MainRole = "buyer" | "supplier" | "bar_seller";

const roleOptions: { value: MainRole; title: string; description: string; icon: typeof UserRound }[] = [
  {
    value: "buyer",
    title: "خریدار",
    description: "برای مشاهده بارهای مجاز، خرید محصول و ثبت درخواست تأمین.",
    icon: UserRound,
  },
  {
    value: "supplier",
    title: "تأمین‌کننده",
    description: "باغدار، کشاورز، تولیدکننده، سورتینگ، باربارکن و فعالیت‌های صادرات یا واردات.",
    icon: Sprout,
  },
  {
    value: "bar_seller",
    title: "بارفروش / حجره‌دار",
    description: "فعال بازار میوه و تره‌بار؛ امکان اعلام بار و فروش عمده و جزئی.",
    icon: Store,
  },
];

function normalizeIranPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0098")) return `+${digits.slice(2)}`;
  if (digits.startsWith("98")) return `+${digits}`;
  if (digits.startsWith("0")) return `+98${digits.slice(1)}`;
  return digits ? `+98${digits}` : "";
}

function AuthPage() {
  const roleParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("role") : null;
  const fixedRole =
    roleParam === "supplier"
      ? "supplier"
      : roleParam === "seller" || roleParam === "bar_seller"
        ? "bar_seller"
        : roleParam === "buyer"
          ? "buyer"
          : null;
  const roleTitle =
    fixedRole === "buyer"
      ? "خریدار"
      : fixedRole === "bar_seller"
        ? "بارفروش"
        : fixedRole === "supplier"
          ? "تأمین‌کننده"
          : null;

  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [authMethod, setAuthMethod] = useState<"phone" | "email">("phone");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [province, setProvince] = useState("البرز");
  const [city, setCity] = useState("کرج");
  const [activity, setActivity] = useState("");
  const [role, setRole] = useState<MainRole>("buyer");

  useEffect(() => {
    if (fixedRole) {
      setRole(fixedRole);
      setMode("login");
    }
  }, [fixedRole]);

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showOtherAccount, setShowOtherAccount] = useState(false);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    let networkWatchdog: number | undefined;
    try {
      setBusy(true);
      networkWatchdog = window.setTimeout(() => {
        setBusy(false);
        setError("ارتباط با سرور پیامک طولانی شد. لطفاً دوباره تلاش کنید.");
      }, 15000);

      setError("");
      setNotice("");
      const normalizedPhone = normalizeIranPhone(phone);

      if (!/^\+\d{10,15}$/.test(normalizedPhone)) {
        setError("شماره موبایل را با قالب معتبر وارد کنید؛ نمونه: 09123456789");
        setBusy(false);
        return;
      }
      if (mode === "signup" && (!province.trim() || !city.trim())) {
        setError("استان و شهر محل فعالیت را انتخاب کنید.");
        setBusy(false);
        return;
      }
      if (mode === "signup" && !acceptedTerms) {
        setError("برای ادامه، پذیرش قوانین ترابار الزامی است.");
        setBusy(false);
        return;
      }
      if (mode === "signup" && role !== "buyer" && !activity.trim()) {
        setError("برای نقش حرفه‌ای، نوع فعالیت یا محصولات را وارد کنید.");
        setBusy(false);
        return;
      }

      const smsRes = await requestSmsOtp(normalizedPhone);
      if (!smsRes.success) {
        setError(smsRes.message);
        setBusy(false);
        return;
      }

      setPhone(normalizedPhone);
      setCodeSent(true);
      setNotice(smsRes.message || "کد تأیید یک‌بارمصرف با موفقیت پیامک شد.");
      setBusy(false);
    } catch (err) {
      console.error("[Terrabar auth] sendCode failed:", err);
      setError("ارتباط با سرور پیامک برقرار نشد. لطفاً اتصال اینترنت را بررسی کنید.");
    } finally {
      if (networkWatchdog) window.clearTimeout(networkWatchdog);
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    let networkWatchdog: number | undefined;
    try {
      setBusy(true);
      networkWatchdog = window.setTimeout(() => {
        setBusy(false);
        setError("ارتباط با سرور طولانی شد. لطفاً دوباره تلاش کنید.");
      }, 15000);

      setError("");
      setNotice("");
      const normalizedPhone = normalizeIranPhone(phone);

      const verifyRes = await submitVerifySmsOtp({
        mobile: normalizedPhone,
        code: code.trim(),
        fullName: fullName.trim() || undefined,
        city,
        province,
        role: role === "bar_seller" ? "seller" : role,
        activity: activity.trim(),
        mode,
      });

      if (!verifyRes.success) {
        setError(verifyRes.message || "کد تأیید پیامک نامعتبر است یا منقضی شده است.");
        setBusy(false);
        return;
      }

      setNotice("ورود با موفقیت انجام شد. در حال انتقال به سایت…");
      setBusy(false);

      const requestedNext =
        new URLSearchParams(window.location.search).get("next") || sessionStorage.getItem("terrabar:after-auth");
      const safeNext =
        requestedNext === "/requests" || (requestedNext ? /^\/store\/[a-zA-Z0-9-]+$/.test(requestedNext) : false)
          ? requestedNext
          : null;

      if (safeNext) sessionStorage.removeItem("terrabar:after-auth");

      window.setTimeout(() => {
        if (safeNext) window.location.assign(safeNext);
        else void navigate({ to: "/member-home" });
      }, 700);
    } catch (err) {
      console.error("[Terrabar auth] verifyCode failed:", err);
      setError("خطا در برقراری ارتباط با سرور. لطفاً دوباره تلاش کنید.");
    } finally {
      if (networkWatchdog) window.clearTimeout(networkWatchdog);
      setBusy(false);
    }
  }

  async function handleEmailAuth(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      setError("");
      setNotice("");

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        setError("نشانی ایمیل معتبر نیست؛ نمونه: example@domain.com");
        setBusy(false);
        return;
      }

      if (!password || password.length < 6) {
        setError("رمز عبور باید حداقل ۶ نویسه (کاراکتر) باشد.");
        setBusy(false);
        return;
      }

      if (mode === "signup" && (!province.trim() || !city.trim())) {
        setError("استان و شهر محل فعالیت را انتخاب کنید.");
        setBusy(false);
        return;
      }

      if (mode === "signup" && !acceptedTerms) {
        setError("برای ادامه، پذیرش قوانین ترابار الزامی است.");
        setBusy(false);
        return;
      }

      if (mode === "signup" && role !== "buyer" && !activity.trim()) {
        setError("برای نقش حرفه‌ای، نوع فعالیت یا محصولات را وارد کنید.");
        setBusy(false);
        return;
      }

      const res = await fetch("/api/auth/email-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          fullName: fullName.trim() || undefined,
          phone: phone.trim() ? normalizeIranPhone(phone) : undefined,
          city,
          province,
          role: role === "bar_seller" ? "seller" : role,
          activity: activity.trim(),
          mode,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        user?: AppUser;
        member?: AppMember;
        roles?: string[];
        sessionToken?: string;
      };

      if (!res.ok || !data.success) {
        setError(data.message || "خطا در احراز هویت با ایمیل.");
        setBusy(false);
        return;
      }

      if (data.sessionToken && data.user) {
        localStorage.setItem(
          "terrabar_d1_session",
          JSON.stringify({
            token: data.sessionToken,
            user: data.user,
            member: data.member,
            roles: data.roles,
          }),
        );

        window.dispatchEvent(
          new CustomEvent("terrabar-auth-change", {
            detail: { token: data.sessionToken, user: data.user },
          }),
        );
      }

      setNotice("ورود با موفقیت انجام شد. در حال انتقال به سایت…");
      setBusy(false);

      const requestedNext =
        new URLSearchParams(window.location.search).get("next") || sessionStorage.getItem("terrabar:after-auth");
      const safeNext =
        requestedNext === "/requests" || (requestedNext ? /^\/store\/[a-zA-Z0-9-]+$/.test(requestedNext) : false)
          ? requestedNext
          : null;

      if (safeNext) sessionStorage.removeItem("terrabar:after-auth");

      window.setTimeout(() => {
        if (safeNext) window.location.assign(safeNext);
        else void navigate({ to: "/member-home" });
      }, 700);
    } catch (err) {
      console.error("[Terrabar auth] handleEmailAuth failed:", err);
      setError("خطا در برقراری ارتباط با سرور. لطفاً دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  if (user && !showOtherAccount && !codeSent && !busy && !error) {
    return (
      <section className="bg-market-surface py-16">
        <div className="site-container max-w-md text-center">
          <CheckCircle2 className="mx-auto mb-4 size-12 text-primary" />
          <h1 className="text-2xl font-extrabold">به ترابار خوش آمدید</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            شما با {user.phone ? `شماره ${user.phone}` : user.email ? `ایمیل ${user.email}` : "حساب کاربری خود"} وارد شده‌اید.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/member-home">ورود به صفحه اصلی کاربران</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowOtherAccount(true);
              }}
            >
              ورود با شماره یا حساب دیگر
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                setShowOtherAccount(true);
              }}
            >
              خروج از حساب
            </Button>
            {isAdmin && (
              <Button asChild variant="secondary">
                <Link to="/admin">ورود به پنل مدیریت</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-market-surface py-10 sm:py-14">
      <div className="site-container max-w-xl">
        <div className="rounded-xl border border-border bg-card p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-accent text-primary">
              {authMethod === "email" ? <Mail className="size-6" /> : <Phone className="size-6" />}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">
                {roleTitle
                  ? `صفحه ورود کاربران ${roleTitle}`
                  : mode === "signup"
                    ? "ثبت‌نام در ترابار"
                    : "ورود به ترابار"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {roleTitle
                  ? `ورود و ثبت‌نام اختصاصی ${roleTitle}`
                  : mode === "login"
                    ? authMethod === "email"
                      ? "برای ورود، ایمیل و رمز عبور خود را وارد نمایید."
                      : "برای ورود، شماره موبایل خود را وارد کنید تا کد تأیید پیامک شود."
                    : "ثبت‌نام سریع و عضویت در سامانه بازار میوه و تره‌بار"}
              </p>
            </div>
          </div>

          {/* Mode Switcher: Signup vs Login */}
          <div className="mt-6 grid grid-cols-2 rounded-lg bg-secondary p-1">
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setCodeSent(false);
                setError("");
                setNotice("");
              }}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                mode === "signup" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              ثبت‌نام جدید
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setCodeSent(false);
                setError("");
                setNotice("");
              }}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                mode === "login" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              ورود به حساب
            </button>
          </div>

          {/* Method Switcher: Mobile SMS vs Email */}
          <div className="mt-4 flex rounded-lg border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => {
                setAuthMethod("phone");
                setCodeSent(false);
                setError("");
                setNotice("");
              }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-bold transition-all ${
                authMethod === "phone" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Phone className="size-3.5" />
              ورود با شماره موبایل (پیامک)
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMethod("email");
                setCodeSent(false);
                setError("");
                setNotice("");
              }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-bold transition-all ${
                authMethod === "email" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Mail className="size-3.5" />
              ورود با ایمیل
            </button>
          </div>

          {authMethod === "email" ? (
            /* EMAIL AUTH FORM */
            <form onSubmit={handleEmailAuth} className="mt-6 grid gap-4">
              {mode === "signup" && (
                <>
                  <label className="field-label">
                    نام و نام خانوادگی
                    <input
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="field-input"
                      placeholder="نام و نام خانوادگی شما"
                      autoComplete="name"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="field-label">
                      <label htmlFor="signup-province-email">استان محل فعالیت</label>
                      <CityPicker
                        value={province}
                        onChange={(value) => {
                          setProvince(value);
                          setCity("");
                        }}
                        id="signup-province-email"
                        options={provinces}
                        placeholder="جست‌وجوی استان…"
                      />
                    </div>
                    <div className="field-label">
                      <label htmlFor="signup-city-email">شهر محل فعالیت</label>
                      <CityPicker
                        value={city}
                        onChange={setCity}
                        id="signup-city-email"
                        options={provinceCities[province] ?? []}
                        disabled={!province}
                        placeholder={province ? "جست‌وجو و انتخاب شهر…" : "ابتدا استان را انتخاب کنید…"}
                      />
                    </div>
                  </div>

                  <label className="field-label">
                    شماره همراه (اختیاری جهت هماهنگی بار)
                    <input
                      dir="ltr"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="field-input text-left"
                      placeholder="09123456789"
                    />
                  </label>

                  {role !== "buyer" && (
                    <label className="field-label">
                      نوع فعالیت / محصولات
                      <input
                        required
                        value={activity}
                        onChange={(e) => setActivity(e.target.value)}
                        className="field-input"
                        placeholder={
                          role === "supplier"
                            ? "مثلاً باغدار مرکبات، کشاورز یا سورتینگ"
                            : "مثلاً حجره و نوع محصولات قابل عرضه"
                        }
                      />
                    </label>
                  )}

                  {!fixedRole && (
                    <fieldset className="grid gap-3">
                      <legend className="mb-1 text-sm font-bold">نقش خود را انتخاب کنید</legend>
                      {roleOptions.map((item) => {
                        const Icon = item.icon;
                        return (
                          <label
                            key={item.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                              role === item.value ? "border-primary bg-accent/50" : "border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              name="main-role-email"
                              value={item.value}
                              checked={role === item.value}
                              onChange={() => setRole(item.value)}
                              className="mt-1 accent-primary"
                            />
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                              <Icon className="size-5" />
                            </span>
                            <span className="flex-1">
                              <strong className="block text-sm">{item.title}</strong>
                              <span className="mt-1 block text-xs leading-6 text-muted-foreground">
                                {item.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )}
                </>
              )}

              <label className="field-label">
                نشانی ایمیل
                <input
                  required
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field-input text-left"
                  placeholder="name@example.com"
                />
              </label>

              <label className="field-label">
                رمز عبور
                <input
                  required
                  type="password"
                  dir="ltr"
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input text-left"
                  placeholder="حداقل ۶ نویسه"
                />
              </label>

              {mode === "signup" && (
                <label className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    <Link to="/rules" className="text-primary underline">
                      قوانین و مقررات ترابار
                    </Link>{" "}
                    را می‌پذیرم.
                  </span>
                </label>
              )}

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-primary">
                  {notice}
                </p>
              )}

              <Button type="submit" disabled={busy}>
                {busy ? "در حال پردازش…" : mode === "signup" ? "ثبت‌نام و ورود با ایمیل" : "ورود با ایمیل"}
                <Lock className="mr-2 size-4" />
              </Button>
            </form>
          ) : !codeSent ? (
            /* PHONE AUTH: STEP 1 (ENTER PHONE) */
            <form onSubmit={sendCode} className="mt-6 grid gap-4">
              {mode === "signup" && (
                <>
                  <label className="field-label">
                    نام و نام خانوادگی
                    <input
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="field-input"
                      placeholder="نام و نام خانوادگی شما"
                      autoComplete="name"
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="field-label">
                      <label htmlFor="signup-province">استان محل فعالیت</label>
                      <CityPicker
                        value={province}
                        onChange={(value) => {
                          setProvince(value);
                          setCity("");
                        }}
                        id="signup-province"
                        options={provinces}
                        placeholder="جست‌وجوی استان…"
                      />
                    </div>
                    <div className="field-label">
                      <label htmlFor="signup-city">شهر محل فعالیت</label>
                      <CityPicker
                        value={city}
                        onChange={setCity}
                        id="signup-city"
                        options={provinceCities[province] ?? []}
                        disabled={!province}
                        placeholder={province ? "جست‌وجو و انتخاب شهر…" : "ابتدا استان را انتخاب کنید…"}
                      />
                    </div>
                  </div>
                  {role !== "buyer" && (
                    <label className="field-label">
                      نوع فعالیت / محصولات
                      <input
                        required
                        value={activity}
                        onChange={(e) => setActivity(e.target.value)}
                        className="field-input"
                        placeholder={
                          role === "supplier"
                            ? "مثلاً باغدار مرکبات، کشاورز یا سورتینگ"
                            : "مثلاً حجره و نوع محصولات قابل عرضه"
                        }
                      />
                    </label>
                  )}
                  {!fixedRole && (
                    <fieldset className="grid gap-3">
                      <legend className="mb-1 text-sm font-bold">نقش خود را انتخاب کنید</legend>
                      {roleOptions.map((item) => {
                        const Icon = item.icon;
                        return (
                          <label
                            key={item.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                              role === item.value ? "border-primary bg-accent/50" : "border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              name="main-role"
                              value={item.value}
                              checked={role === item.value}
                              onChange={() => setRole(item.value)}
                              className="mt-1 accent-primary"
                            />
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                              <Icon className="size-5" />
                            </span>
                            <span className="flex-1">
                              <strong className="block text-sm">{item.title}</strong>
                              <span className="mt-1 block text-xs leading-6 text-muted-foreground">
                                {item.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )}
                  <label className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                      className="mt-1 accent-primary"
                    />
                    <span>
                      <Link to="/rules" className="text-primary underline">
                        قوانین و مقررات ترابار
                      </Link>{" "}
                      را می‌پذیرم.
                    </span>
                  </label>
                </>
              )}

              <label className="field-label">
                شماره موبایل
                <input
                  required
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="field-input text-left"
                  placeholder="09123456789"
                />
              </label>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-primary">
                  {notice}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? "در حال ارسال…" : "دریافت کد پیامکی"}
                <Phone className="mr-2 size-4" />
              </Button>

              <button
                type="button"
                onClick={() => {
                  const cleaned = phone.replace(/[^\d]/g, "");
                  if (cleaned.length >= 10) {
                    setCodeSent(true);
                    setError("");
                  } else {
                    setError("ابتدا شماره همراه خود را وارد کنید (مثال: ۰۹۱۲۳۴۵۶۷۸۹).");
                  }
                }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors underline text-center pt-1"
              >
                کد تأیید را از قبل در پیامک دریافت کرده‌اید؟ ورود کد تأیید
              </button>
            </form>
          ) : (
            /* PHONE AUTH: STEP 2 (ENTER OTP CODE) */
            <form onSubmit={verifyCode} className="mt-6 grid gap-4">
              <div className="rounded-lg bg-accent/40 p-4 text-sm">
                <p className="font-semibold">کد تأیید برای {phone} پیامک شد</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  کد ۶ رقمی دریافتی را وارد کنید تا ورود شما تکمیل شود.
                </p>
              </div>
              <label className="field-label">
                کد یک‌بارمصرف
                <input
                  required
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="field-input text-center text-lg tracking-[0.4em]"
                  placeholder="000000"
                />
                <span className="text-xs font-normal text-muted-foreground">
                  کد ۶ رقمی ارسال‌شده به شماره همراه شما
                </span>
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-primary">
                  {notice}
                </p>
              )}
              <Button type="submit" disabled={busy || code.trim().length !== 6}>
                {busy ? "در حال تأیید و ورود…" : "تأیید کد و ورود به سایت"}
                <ShieldCheck className="mr-2 size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                  setError("");
                  setNotice("");
                }}
              >
                اصلاح شماره / ارسال دوباره
              </Button>
            </form>
          )}

          {error && !codeSent && authMethod === "phone" && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && !codeSent && authMethod === "phone" && (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm text-primary">
              <Clock3 className="size-4" />
              {notice}
            </p>
          )}
          <Button asChild variant="link" className="mt-4 w-full">
            <Link to="/">بازگشت به صفحه اصلی</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
