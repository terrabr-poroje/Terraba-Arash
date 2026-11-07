/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Terrabar Application Database Client Adapter
 */

function getStoredD1Session(): any {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("terrabar_d1_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getStoredTableRows(tableName: string): any[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`tb_tbl_${tableName}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredTableRows(tableName: string, rows: any[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`tb_tbl_${tableName}`, JSON.stringify(rows));
  } catch {
    // Storage access may be restricted in private browsing
  }
}

// Chainable query builder for application database operations
function createD1QueryBuilder(tableName: string) {
  let selectFields = "*";
  const filters: Array<{ field: string; op: string; value: any }> = [];
  let isSingle = false;
  let isMaybeSingle = false;
  let orderByCol = "";
  let orderAscending = false;
  let limitCount: number | null = null;

  const builder: any = {
    select(fields = "*") {
      selectFields = fields;
      return builder;
    },
    eq(field: string, value: any) {
      filters.push({ field, op: "=", value });
      return builder;
    },
    neq(field: string, value: any) {
      filters.push({ field, op: "!=", value });
      return builder;
    },
    in(field: string, values: any[]) {
      filters.push({ field, op: "IN", value: Array.isArray(values) ? values : [values] });
      return builder;
    },
    or(_filterExpr: string) {
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderByCol = col;
      orderAscending = opts?.ascending ?? true;
      return builder;
    },
    limit(count: number) {
      limitCount = count;
      return builder;
    },
    single() {
      isSingle = true;
      return builder.then();
    },
    maybeSingle() {
      isMaybeSingle = true;
      return builder.then();
    },
    async insert(rows: any | any[]) {
      const rowList = Array.isArray(rows) ? rows : [rows];
      const inserted = rowList.map((r, i) => ({
        id: r.id || `row_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
        created_at: new Date().toISOString(),
        ...r,
      }));

      const existing = getStoredTableRows(tableName);
      saveStoredTableRows(tableName, [...inserted, ...existing]);

      const result = isSingle ? inserted[0] : inserted;
      return {
        data: result,
        error: null,
        select: () => ({
          single: async () => ({ data: inserted[0], error: null }),
          maybeSingle: async () => ({ data: inserted[0] || null, error: null }),
        }),
      };
    },
    async update(values: any) {
      const existing = getStoredTableRows(tableName);
      const updated = existing.map((row) => {
        let matches = true;
        for (const f of filters) {
          if (f.op === "=" && row[f.field] !== f.value) matches = false;
          if (f.op === "!=" && row[f.field] === f.value) matches = false;
          if (f.op === "IN" && Array.isArray(f.value) && !f.value.includes(row[f.field])) matches = false;
        }
        return matches ? { ...row, ...values, updated_at: new Date().toISOString() } : row;
      });
      saveStoredTableRows(tableName, updated);
      return { data: values, error: null };
    },
    async delete() {
      const existing = getStoredTableRows(tableName);
      const remaining = existing.filter((row) => {
        let matches = true;
        for (const f of filters) {
          if (f.op === "=" && row[f.field] !== f.value) matches = false;
          if (f.op === "!=" && row[f.field] === f.value) matches = false;
          if (f.op === "IN" && Array.isArray(f.value) && !f.value.includes(row[f.field])) matches = false;
        }
        return !matches;
      });
      saveStoredTableRows(tableName, remaining);
      return { data: null, error: null };
    },
    async then(resolve?: (val: any) => any, _reject?: any) {
      const sess = getStoredD1Session();
      let resultData: any[] = [];

      if (tableName === "members") {
        const storedMembers = getStoredTableRows("members");
        const activeMember = sess?.member
          ? {
              ...sess.member,
              auth_user_id: sess.member.auth_user_id || sess.user?.id || sess.member.id,
            }
          : sess?.user
            ? {
                id: `mem_${sess.user.id}`,
                auth_user_id: sess.user.id,
                full_name: sess.user.full_name || "کاربر ترابار",
                phone: sess.user.phone || "",
                city: sess.user.city || "",
                province: sess.user.province || "",
                role: sess.user.role || "buyer",
              }
            : null;
        resultData = activeMember ? [activeMember, ...storedMembers.filter((m) => m.id !== activeMember.id)] : storedMembers;
      } else if (tableName === "member_roles") {
        if (sess?.roles) {
          resultData = sess.roles.map((r: string, idx: number) => ({
            id: `mr_${idx}`,
            role_code: r,
            approval_status: "approved",
          }));
        }
      } else if (tableName === "admin_users") {
        if (sess?.roles?.includes("admin")) {
          resultData = [{ id: "adm_1", admin_role: "main_admin", is_active: true }];
        }
      } else {
        resultData = getStoredTableRows(tableName);
      }

      // Apply filters
      let filtered = resultData.filter((row) => {
        for (const f of filters) {
          if (f.op === "=" && String(row[f.field]) !== String(f.value)) return false;
          if (f.op === "!=" && String(row[f.field]) === String(f.value)) return false;
          if (f.op === "IN" && Array.isArray(f.value) && !f.value.map(String).includes(String(row[f.field]))) return false;
        }
        return true;
      });

      // Order
      if (orderByCol) {
        filtered.sort((a, b) => {
          const valA = a[orderByCol] ?? "";
          const valB = b[orderByCol] ?? "";
          if (valA < valB) return orderAscending ? -1 : 1;
          if (valA > valB) return orderAscending ? 1 : -1;
          return 0;
        });
      }

      if (limitCount !== null && limitCount > 0) {
        filtered = filtered.slice(0, limitCount);
      }

      let finalResult = filtered;
      if (isSingle || isMaybeSingle) {
        finalResult = filtered[0] || null;
      }

      const res = { data: finalResult, error: null };
      return resolve ? resolve(res) : res;
    },
  };

  return builder;
}

export const supabase: any = {
  auth: {
    async getUser() {
      const sess = getStoredD1Session();
      return {
        data: {
          user: sess?.user
            ? {
                id: sess.user.id,
                phone: sess.user.phone,
                email: sess.user.email || `phone_${sess.user.phone}@terrabar.ir`,
                user_metadata: sess.user,
              }
            : null,
        },
        error: null,
      };
    },
    async getSession() {
      const sess = getStoredD1Session();
      return {
        data: {
          session: sess
            ? {
                access_token: sess.token,
                user: sess.user,
              }
            : null,
        },
        error: null,
      };
    },
    async signOut() {
      if (typeof window !== "undefined") {
        localStorage.removeItem("terrabar_d1_session");
        document.cookie = "tb_session=; Path=/; Max-Age=0; SameSite=Lax";
        window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: null }));
      }
      return { error: null };
    },
    onAuthStateChange(callback: (event: string, session: any) => void) {
      if (typeof window === "undefined") {
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
      const handler = (e: Event) => {
        const custom = e as CustomEvent<any>;
        const session = custom.detail ? { access_token: custom.detail.token, user: custom.detail.user } : null;
        callback(session ? "SIGNED_IN" : "SIGNED_OUT", session);
      };
      window.addEventListener("terrabar-auth-change", handler);
      return {
        data: {
          subscription: {
            unsubscribe: () => window.removeEventListener("terrabar-auth-change", handler),
          },
        },
      };
    },
  },
  from(tableName: string) {
    return createD1QueryBuilder(tableName);
  },
  storage: {
    from(bucketName: string) {
      return {
        async upload(path: string, file: File | Blob, options?: any) {
          try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("key", path);
            formData.append("bucket", bucketName);

            const res = await fetch("/api/storage/upload", {
              method: "POST",
              body: formData,
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              return { data: null, error: new Error(err.message || "Upload failed") };
            }
            const data = await res.json();
            return { data: { path: data.fileKey }, error: null };
          } catch (e: any) {
            return { data: null, error: e };
          }
        },
        async remove(paths: string[]) {
          try {
            for (const p of paths) {
              await fetch("/api/storage/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: p }),
              });
            }
            return { data: paths, error: null };
          } catch (e: any) {
            return { data: null, error: e };
          }
        },
        async createSignedUrl(path: string, _expiresIn = 3600) {
          return { data: { signedUrl: `/api/storage/file/${path.replace(/^\/+/, "")}` }, error: null };
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `/api/storage/file/${path.replace(/^\/+/, "")}` } };
        },
      };
    },
  },
  functions: {
    async invoke() {
      return { data: null, error: null };
    },
  },
};
