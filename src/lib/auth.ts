/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";

export type AppRole = "admin" | "city_manager" | "supplier" | "seller" | "buyer";

export interface AppUser {
  id: string;
  phone?: string;
  full_name?: string;
  role?: string;
  city?: string;
  province?: string;
  email?: string;
}

export interface AppMember {
  id: string;
  auth_user_id: string;
  full_name: string;
  phone: string;
  role: string;
  city: string;
  province: string;
}

export interface AppSession {
  token: string;
  user: AppUser;
  member?: AppMember;
  roles?: string[];
}

export function useAuth() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    function applySession(sess: AppSession | null) {
      if (!active) return;
      setSession(sess);

      if (sess && sess.user) {
        const roleSet = new Set<AppRole>();
        const roleStrings = (sess.roles || [sess.user.role || "buyer"]).map((r) => r.toLowerCase());

        for (const r of roleStrings) {
          if (r === "admin" || r === "main_admin") roleSet.add("admin");
          if (r === "city_manager") roleSet.add("city_manager");
          if (r === "supplier") roleSet.add("supplier");
          if (r === "seller" || r === "bar_seller") roleSet.add("seller");
          if (r === "buyer") roleSet.add("buyer");
        }
        if (roleSet.size === 0) roleSet.add("buyer");
        setRoles([...roleSet]);
      } else {
        setRoles([]);
      }
      setLoading(false);
    }

    // 1. Restore fast from localStorage
    try {
      const stored = localStorage.getItem("terrabar_d1_session");
      if (stored) {
        const parsed = JSON.parse(stored) as AppSession;
        if (parsed?.token && parsed?.user) {
          applySession(parsed);
        }
      }
    } catch (e) {
      console.warn("[useAuth] Failed to parse local session:", e);
    }

    // 2. Validate with D1 server session with 6s timeout
    async function verifyWithServer() {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller ? window.setTimeout(() => controller.abort(), 6000) : null;

      try {
        const stored = localStorage.getItem("terrabar_d1_session");
        const token = stored ? (JSON.parse(stored) as AppSession)?.token : "";

        const res = await fetch("/api/auth/session", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller?.signal,
        });
        if (!res.ok) {
          if (active) setLoading(false);
          return;
        }

        const data = (await res.json().catch(() => ({}))) as { session?: any };
        if (active) {
          if (data?.session) {
            const updatedSession: AppSession = {
              token: data.session.sessionToken || token,
              user: data.session.user,
              member: data.session.member,
              roles: data.session.roles,
            };
            localStorage.setItem("terrabar_d1_session", JSON.stringify(updatedSession));
            applySession(updatedSession);
          } else if (!data?.session && token) {
            // Server has no record of this session
            localStorage.removeItem("terrabar_d1_session");
            applySession(null);
          } else if (!stored) {
            applySession(null);
          }
        }
      } catch (err) {
        console.warn("[useAuth] Server session validation skipped:", err);
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (active) setLoading(false);
      }
    }

    void verifyWithServer();

    // 3. Listen to auth changes in current tab and across other open tabs
    function onAuthChange(e: Event) {
      const custom = e as CustomEvent<AppSession | null>;
      applySession(custom.detail ?? null);
    }

    function onStorageEvent(e: StorageEvent) {
      if (e.key === "terrabar_d1_session") {
        try {
          const sess = e.newValue ? (JSON.parse(e.newValue) as AppSession) : null;
          applySession(sess);
        } catch {
          applySession(null);
        }
      }
    }

    window.addEventListener("terrabar-auth-change", onAuthChange);
    window.addEventListener("storage", onStorageEvent);
    return () => {
      active = false;
      window.removeEventListener("terrabar-auth-change", onAuthChange);
      window.removeEventListener("storage", onStorageEvent);
    };
  }, []);

  return {
    session,
    user: session?.user ?? null,
    member: session?.member ?? null,
    roles,
    loading,
    isAdmin: roles.includes("admin"),
    canAnnounce: roles.includes("supplier") || roles.includes("seller"),
  };
}

export async function signOut() {
  try {
    const stored = localStorage.getItem("terrabar_d1_session");
    const token = stored ? (JSON.parse(stored) as AppSession)?.token : "";

    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  } finally {
    localStorage.removeItem("terrabar_d1_session");
    document.cookie = "tb_session=; Path=/; Max-Age=0; SameSite=Lax";
    window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: null }));
  }
}
