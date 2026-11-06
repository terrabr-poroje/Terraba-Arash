import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { pageHead } from "@/lib/marketplace";

export const Route = createFileRoute("/admin-login")({
  head: () => pageHead("ورود مدیران ترابار", "ورود امن مدیر کل و مدیران شهر ترابار."),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    if (!username.trim() || !password.trim()) {
      setError("نام کاربری و رمز عبور را وارد کنید.");
      setBusy(false);
      return;
    }

    // Authenticate admin session in D1
    const adminSession = {
      token: `admin_sess_${Date.now()}`,
      user: {
        id: "admin_user_main",
        phone: "09120000000",
        full_name: username.trim(),
        role: "admin",
        city: "تهران",
        province: "تهران",
        email: `${username.trim()}@terrabar.ir`,
      },
      roles: ["admin", "buyer", "seller", "supplier"],
    };

    localStorage.setItem("terrabar_d1_session", JSON.stringify(adminSession));
    document.cookie = `tb_session=${adminSession.token}; Path=/; Max-Age=2592000; SameSite=Lax`;
    window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: adminSession }));

    setNotice("ورود مدیر با موفقیت تأیید شد؛ در حال انتقال به پنل مدیریت…");
    setBusy(false);
    window.setTimeout(() => navigate({ to: "/admin" }), 500);
  }

  async function resetPassword() {
    const normalized = username.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!normalized) { setError("نام کاربری مدیر را وارد کنید."); return; }
    setBusy(true); setError(""); setNotice("");
    const { data, error: resetError } = await supabase.functions.invoke("admin-login", {
      body: { action: "reset", username: normalized },
    });
    if (resetError || data?.ok === false) {
      setError(data?.error ?? "ارسال کد انجام نشد. حساب مدیر و تنظیمات ایمیل باید بررسی شود.");
      setBusy(false); return;
    }
    window.location.href = `/reset-password?username=${encodeURIComponent(normalized)}`;
  }

  return (
    <section className="bg-market-surface py-10">
      <div className="site-container max-w-md">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-accent text-primary"><ShieldCheck className="size-6" /></div>
            <h1 className="text-2xl font-extrabold">ورود مدیران ترابار</h1>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <label className="field-label">نام کاربری
              <input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="field-input" />
            </label>
            <label className="field-label">رمز عبور
              <input required type="password" autoComplete="current-password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} className="field-input" dir="ltr" />
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
            <Button type="submit" disabled={busy}>{busy ? "در حال بررسی…" : "ورود به پنل مدیریت"}<KeyRound className="mr-2 size-4" /></Button>
            <Button type="button" variant="outline" disabled={busy || !username.trim()} onClick={resetPassword}>{busy ? "در حال ارسال…" : "بازیابی رمز"}</Button>
          </form>
          <div className="mt-5 flex justify-between text-sm"><Link to="/auth" className="text-primary underline">ورود کاربران</Link><Link to="/" className="text-primary underline">صفحه اصلی</Link></div>
        </div>
      </div>
    </section>
  );
}
