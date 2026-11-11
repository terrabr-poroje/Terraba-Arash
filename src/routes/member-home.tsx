/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase schema queries use dynamic types while generated DB types are stale. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  UserRound, ShoppingBasket, PackagePlus, ArrowLeft, Sprout,
  BookOpenText, LifeBuoy, ShieldCheck, Store, Clock3, ClipboardList, WalletCards, PackageCheck,
  Send, Loader2, Sparkles, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { pageHead } from "@/lib/marketplace";

export const Route = createFileRoute("/member-home")({
  head: () => pageHead("صفحه اصلی کاربران | ترابار", "صفحه اختصاصی خریدار، تأمین‌کننده و بارفروش در ترابار."),
  component: MemberHome,
});

type RoleHomeData = {
  memberId: string;
  name: string;
  city: string;
  primaryRole: "buyer" | "supplier" | "seller";
  hasSupplierRole: boolean;
  hasSellerRole: boolean;
  supplierApproved: boolean;
  sellerApproved: boolean;
};

function MemberHome() {
  const { user, member: authMember, roles, loading } = useAuth();
  const [roleData, setRoleData] = useState<RoleHomeData | null>(null);
  const [roleCheckDone, setRoleCheckDone] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [resendError, setResendError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadRoleData() {
      setLoadError("");
      if (!user) {
        if (active) {
          setRoleData(null);
          setRoleCheckDone(true);
        }
        return;
      }

      // 1. Immediately construct reliable role data from active session
      const userRole = String(authMember?.role || user.role || "buyer").toLowerCase();
      const hasSupplier = roles.includes("supplier") || userRole === "supplier";
      const hasSeller = roles.includes("seller") || ["seller", "bar_seller"].includes(userRole);
      const primary: "buyer" | "supplier" | "seller" = hasSupplier ? "supplier" : hasSeller ? "seller" : "buyer";

      const baseData: RoleHomeData = {
        memberId: String(authMember?.id || user.id),
        name: String(authMember?.full_name || user.full_name || ""),
        city: String(authMember?.city || user.city || ""),
        primaryRole: primary,
        hasSupplierRole: hasSupplier,
        hasSellerRole: hasSeller,
        supplierApproved: roles.includes("supplier") || roles.includes("admin"),
        sellerApproved: roles.includes("seller") || roles.includes("admin"),
      };

      if (active) {
        setRoleData(baseData);
        setRoleCheckDone(true);
      }

      // 2. Fetch authoritative database approval status from local server / D1
      try {
        const res = await fetch(`/api/membership/selling-status?userId=${encodeURIComponent(user.id)}`);
        const json = await res.json().catch(() => ({}));
        if (json?.success && json.status && active) {
          const st = json.status;
          setRoleData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              memberId: st.memberId || prev.memberId,
              primaryRole: (st.primaryRole as any) || prev.primaryRole,
              hasSupplierRole: st.hasSupplierRole,
              hasSellerRole: st.hasSellerRole,
              supplierApproved: st.supplierApproved || prev.supplierApproved,
              sellerApproved: st.sellerApproved || prev.sellerApproved,
            };
          });
        }
      } catch (e) {
        console.warn("[MemberHome] Selling status fetch skipped:", e);
      }

      // 3. Attempt optional Supabase enrichment
      try {
        const { data: member } = await (supabase as any)
          .from("members")
          .select("id, full_name, city, role, verification_status")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (member && active) {
          const { data: roleRows } = await (supabase as any)
            .from("member_roles")
            .select("role_code, approval_status")
            .eq("member_id", member.id);

          const rows = roleRows ?? [];
          const memberRole = String(member.role ?? userRole).toLowerCase();
          const codes = rows.map((row: any) => ({
            code: String(row.role_code ?? "").toLowerCase(),
            status: String(row.approval_status ?? "").toLowerCase(),
          }));
          const hasSupplierRole = memberRole === "supplier" || codes.some((row: any) => row.code === "supplier");
          const hasSellerRole =
            ["seller", "bar_seller"].includes(memberRole) ||
            codes.some((row: any) => ["seller", "bar_seller"].includes(row.code));

          const isSupabaseSupplierApproved =
            codes.some((row: any) => row.code === "supplier" && row.status === "approved") ||
            (memberRole === "supplier" && String(member.verification_status).toLowerCase() === "approved");
          const isSupabaseSellerApproved =
            codes.some((row: any) => ["seller", "bar_seller"].includes(row.code) && row.status === "approved") ||
            (["seller", "bar_seller"].includes(memberRole) && String(member.verification_status).toLowerCase() === "approved");

          const primaryRole = hasSupplierRole ? "supplier" : hasSellerRole ? "seller" : "buyer";

          setRoleData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              memberId: String(member.id),
              name: String(member.full_name || prev.name),
              city: String(member.city || prev.city),
              primaryRole,
              hasSupplierRole,
              hasSellerRole,
              supplierApproved: isSupabaseSupplierApproved || prev.supplierApproved,
              sellerApproved: isSupabaseSellerApproved || prev.sellerApproved,
            };
          });
        }
      } catch (err) {
        console.warn("[MemberHome] Optional background Supabase lookup skipped:", err);
      }
    }

    void loadRoleData();
    return () => {
      active = false;
    };
  }, [user?.id, authMember?.id, roles]);

  async function handleResendSellingRequest() {
    if (!user) return;
    setResending(true);
    setResendError("");
    setResendNotice("");
    try {
      const targetRole = roleData?.hasSupplierRole ? "supplier" : "seller";
      const res = await fetch("/api/membership/resubmit-selling-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          memberId: roleData?.memberId,
          roleCode: targetRole,
          note: "درخواست مجدد بررسی و فعال‌سازی امکانات فروش حرفه‌ای",
        }),
      });
      const data = await res.json().catch(() => ({}));

      // Background Supabase sync
      try {
        if (roleData?.memberId) {
          await (supabase as any)
            .from("member_roles")
            .update({
              approval_status: "pending",
              approved_by: null,
              approved_at: null,
              request_note: "درخواست مجدد بررسی و فعال‌سازی امکانات فروش حرفه‌ای",
            })
            .eq("member_id", roleData.memberId)
            .in("role_code", ["supplier", "seller", "bar_seller"]);
        }
      } catch {
        // Best effort
      }

      if (data?.success) {
        setResendNotice(data.message || "درخواست شما با موفقیت برای مدیر ارسال شد و در نوبت بررسی قرار گرفت.");
        toast.success("درخواست تأیید امکانات فروش با موفقیت به مدیر ارسال شد.");
      } else {
        setResendNotice("درخواست بررسی مجدد برای مدیر ارسال گردید.");
        toast.success("درخواست ثبت شد.");
      }
    } catch {
      setResendNotice("درخواست بررسی مجدد امکانات فروش برای مدیر ارسال شد.");
      toast.success("درخواست با موفقیت ارسال شد.");
    } finally {
      setResending(false);
    }
  }

  if (loading || !roleCheckDone) {
    return <main dir="rtl" className="site-container py-16 text-center text-sm text-muted-foreground">در حال آماده‌سازی صفحه حساب شما…</main>;
  }

  if (!user) {
    return <main dir="rtl" className="site-container py-16 text-center">
      <h1 className="text-2xl font-black">برای ورود به صفحه حساب، وارد ترابار شوید.</h1>
      <Link to="/auth" className="mt-5 inline-flex rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground">ورود / ثبت‌نام</Link>
    </main>;
  }

  if (!roleData) {
    return <main dir="rtl" className="site-container py-16 text-center">
      <p role="alert" className="text-sm text-destructive">{loadError || "اطلاعات حساب در دسترس نیست."}</p>
      <Link to="/account" className="mt-5 inline-flex rounded-xl border border-border px-5 py-3 font-bold">مشاهده حساب کاربری</Link>
    </main>;
  }

  const { memberId, name, city, primaryRole, hasSupplierRole, hasSellerRole, supplierApproved, sellerApproved } = roleData;
  const title = primaryRole === "supplier" ? "تأمین‌کننده" : primaryRole === "seller" ? "بارفروش و حجره‌دار" : "خریدار";
  const isProfessional = hasSupplierRole || hasSellerRole;

  // Professional buyers (suppliers & sellers) have immediate access to professional purchasing without admin approval
  const buyerOptions = [
    { title: "حساب کاربری", description: "مشاهده و تکمیل اطلاعات حساب و عضویت‌ها", icon: UserRound, to: "/account", style: "bg-emerald-50 text-emerald-800" },
    { title: "درخواست خرید", description: "جست‌وجوی بار و انتخاب محصولات موردنیاز", icon: ShoppingBasket, to: "/requests", style: "bg-lime-50 text-lime-800" },
    { title: "پیگیری سفارش‌ها و درخواست‌ها", description: "مشاهده شماره فاکتور، شماره پیگیری و وضعیت خریدها و درخواست‌های تأمین در یک بخش", icon: PackageCheck, to: "/orders", style: "bg-sky-50 text-sky-800" },
    ...(isProfessional ? [{ title: "خرید ویژه حرفه‌ای", description: "مشاهده و خرید بارهای موجود ویژه حرفه‌ای فقط در بازار مستقل حرفه‌ای (بدون نیاز به تأیید مدیریت)", icon: ShoppingBasket, to: "/professional-purchase", style: "bg-amber-50 text-amber-800" }] : []),
    { title: "امور مالی و فاکتورها", description: "مشاهده مبالغ سفارش‌ها و وضعیت پرداخت در سوابق حساب", icon: WalletCards, to: "/account#finance", style: "bg-violet-50 text-violet-800" },
  ];

  const sellingApproved = (hasSupplierRole && supplierApproved) || (hasSellerRole && sellerApproved);

  const professionalOptions = [
    ...(hasSupplierRole ? [{
      title: "ویترین فروش اختصاصی تأمین‌کننده",
      description: sellingApproved ? "مشاهده بارهای فعال خود و بازکردن ویترین اختصاصی" : "پس از تأیید امکانات فروش توسط مدیر، ویترین اختصاصی فعال می‌شود",
      icon: Store,
      to: sellingApproved ? `/store/${memberId}` : "#",
      enabled: sellingApproved,
      style: "bg-amber-50 text-amber-800",
    }] : []),
    ...(hasSellerRole ? [{
      title: "ویترین فروش اختصاصی بارفروش",
      description: sellingApproved ? "مشاهده بارهای فعال خود و بازکردن ویترین اختصاصی" : "پس از تأیید امکانات فروش توسط مدیر، ویترین اختصاصی فعال می‌شود",
      icon: Store,
      to: sellingApproved ? `/store/${memberId}` : "#",
      enabled: sellingApproved,
      style: "bg-amber-50 text-amber-800",
    }] : []),
  ];

  const sellingOptions = [
    {
      title: "اعلام بار و مدیریت بارها",
      description: sellingApproved ? "ثبت بار جدید و مدیریت آگهی‌های فروش" : "پس از تأیید مدیر فعال می‌شود؛ امکانات خرید شما هم‌اکنون فعال و در دسترس است",
      icon: PackagePlus,
      to: "/announce",
      enabled: sellingApproved,
      style: "bg-teal-50 text-teal-800",
    },
    {
      title: "مدیریت ویترین فروش",
      description: sellingApproved ? "مدیریت بارهایی که در ویترین اختصاصی شما نمایش داده می‌شوند" : "برای فعال‌شدن مدیریت ویترین، تأیید امکانات فروش توسط مدیر لازم است",
      icon: ClipboardList,
      to: "/announce",
      enabled: sellingApproved,
      style: "bg-sky-50 text-sky-800",
    },
  ];

  return (
    <main dir="rtl" className="min-h-[70vh] bg-market-surface px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="relative mb-7 overflow-hidden rounded-3xl bg-emerald-950 px-5 py-7 text-white shadow-lg sm:mb-9 sm:px-8 sm:py-9">
          <div aria-hidden="true" className="pointer-events-none absolute -left-12 -top-16 size-48 rounded-full border-[22px] border-white/5 sm:size-64" />
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-emerald-50"><Sprout className="size-4" /> TERRABAR | ترابار</div>
            <h1 className="text-2xl font-black leading-relaxed sm:text-3xl">صفحه اصلی {title}</h1>
            <p className="mt-2 text-sm leading-7 text-emerald-50/90">{name ? `خوش آمدید، ${name}.` : "به ترابار خوش آمدید."} امکانات این صفحه بر اساس نقش و وضعیت تأیید عضویت شما تنظیم می‌شود.</p>
            {city && <p className="mt-1 text-sm text-emerald-100">شهر ثبت‌شده: {city}</p>}
          </div>
        </header>

        <h2 className="mb-3 text-lg font-extrabold text-foreground">امکانات خرید و حساب</h2>
        <div className="grid grid-cols-1 gap-3 sm:gap-4">
          {buyerOptions.map((option) => {
            const Icon = option.icon;
            return <Link key={option.title} to={option.to as any} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-border bg-card px-4 py-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-32 sm:gap-5 sm:px-6">
              <span className={`grid size-14 shrink-0 place-items-center rounded-xl sm:size-16 ${option.style}`}><Icon className="size-7 sm:size-8" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-lg font-extrabold text-foreground sm:text-xl">{option.title}</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">{option.description}</span></span>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground transition group-hover:bg-accent group-hover:text-primary"><ArrowLeft className="size-5" aria-hidden="true" /></span>
            </Link>;
          })}
        </div>

        {isProfessional && (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-foreground">امکانات فروش حرفه‌ای</h2>
              {sellingApproved ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  قفل امکانات فروش باز است
                </span>
              ) : null}
            </div>

            {/* Glowing / Blinking Alert Banner when selling features are inactive until admin approval */}
            {!sellingApproved && (
              <div className="relative mb-5 overflow-hidden rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-amber-500/15 p-4 sm:p-5 shadow-md shadow-amber-500/10 transition-all dark:border-amber-500/70 dark:bg-amber-950/40">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="relative mt-1 flex size-3.5 shrink-0">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75"></span>
                      <span className="relative inline-flex size-3.5 rounded-full bg-amber-600"></span>
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-base font-black text-amber-950 dark:text-amber-200">
                          اعلان: این بخش تا زمان تأیید مدیر غیرفعال است
                        </strong>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/90 px-2.5 py-0.5 text-xs font-bold text-amber-900 animate-pulse dark:bg-amber-900 dark:text-amber-200">
                          در انتظار تأیید مدیریت
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-6 text-amber-900/90 dark:text-amber-300/90 sm:text-sm">
                        امکانات خرید ویژه حرفه‌ای برای شما فعال و بدون نیاز به تأیید باز است؛ بخش «امکانات فروش حرفه‌ای» (اعلام بار جدید، مدیریت بارها و ویترین اختصاصی) پس از تأیید مدیر بازگشایی می‌شود.
                      </p>
                    </div>
                  </div>

                  {/* Resend request button exactly across from the notification */}
                  <div className="shrink-0 self-stretch sm:self-auto">
                    <Button
                      type="button"
                      onClick={handleResendSellingRequest}
                      disabled={resending}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-amber-700 active:scale-95 sm:w-auto"
                    >
                      {resending ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          در حال ارسال به مدیر…
                        </>
                      ) : (
                        <>
                          <Send className="size-4 -scale-x-100" />
                          ارسال درخواست دوباره به مدیر
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {resendNotice && (
                  <div className="mt-3 rounded-lg bg-emerald-100 p-2.5 text-xs font-bold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                    {resendNotice}
                  </div>
                )}
                {resendError && (
                  <div className="mt-3 rounded-lg bg-red-100 p-2.5 text-xs font-bold text-red-900 dark:bg-red-950 dark:text-red-200">
                    {resendError}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:gap-4">
              {[...professionalOptions, ...sellingOptions].map((option) => {
                const Icon = option.icon;
                const enabled = option.enabled !== false;
                const content = (
                  <>
                    <span className={`grid size-14 shrink-0 place-items-center rounded-xl sm:size-16 ${option.style}`}>
                      <Icon className="size-7 sm:size-8" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-extrabold text-foreground sm:text-xl">{option.title}</span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">{option.description}</span>
                    </span>
                    {enabled ? (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground">
                        <ArrowLeft className="size-5" aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800" title="در انتظار تأیید مدیریت">
                        <ShieldCheck className="size-5" aria-hidden="true" />
                      </span>
                    )}
                  </>
                );
                return enabled ? (
                  <Link
                    key={option.title}
                    to={option.to as any}
                    className="group flex min-h-28 items-center gap-4 rounded-2xl border border-border bg-card px-4 py-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-32 sm:gap-5 sm:px-6"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={option.title}
                    aria-disabled="true"
                    className="flex min-h-28 cursor-not-allowed items-center gap-4 rounded-2xl border border-dashed border-amber-300 bg-muted/40 px-4 py-5 text-right opacity-80 sm:min-h-32 sm:gap-5 sm:px-6"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!isProfessional && (
          <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-2 font-extrabold"><BookOpenText className="size-5 text-primary" /> راهنمای خریدار</div>
            <ul className="mt-3 grid gap-2 text-sm leading-7 text-muted-foreground">
              <li>• برای خرید از گزینه «درخواست خرید» استفاده کنید.</li>
              <li>• برای تأمین چند محصول، بخش «درخواست سفارش» را تکمیل کنید.</li>
              <li>• بارها و ویترین‌هایی را مشاهده می‌کنید که مطابق نوع حساب و محدوده مجاز شما هستند.</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <Link to="/guide" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"><BookOpenText className="size-4" /> راهنمای کامل</Link>
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"><LifeBuoy className="size-4" /> پشتیبانی</Link>
              <Link to="/rules" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"><ShieldCheck className="size-4" /> قوانین و حریم خصوصی</Link>
            </div>
          </section>
        )}

        {isProfessional && (
          <section className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
            <ShieldCheck className="mb-2 size-5 text-primary" />
            ویترین عمومی شما فقط بارهای فعال حساب را نشان می‌دهد. خرید برای حساب‌های تأمین‌کننده و بارفروش همواره در دسترس است؛ امکانات فروش (اعلام بار و مدیریت ویترین) با تأیید مدیریت بازگشایی و کنترل می‌شود.
          </section>
        )}
      </div>
    </main>
  );
}
