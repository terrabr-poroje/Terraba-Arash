/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import { createRequire } from "node:module";

let cachedDbSync: any = null;
function getDatabaseSync() {
  if (cachedDbSync !== null) return cachedDbSync;
  try {
    // Only in Node.js runtime (not in browser or Cloudflare Workers)
    if (typeof process !== "undefined" && process.versions?.node) {
      const require = createRequire(import.meta.url);
      const sqliteMod = require("node:sqlite");
      cachedDbSync = sqliteMod?.DatabaseSync || false;
      return cachedDbSync;
    }
  } catch {
    cachedDbSync = false;
  }
  return false;
}

/**
 * Cloudflare D1 Database Layer
 * Database ID: 9da7735b-e4c9-4f7f-9abe-53ba1545c60e
 * 
 * Works seamlessly across both:
 * 1. Cloudflare Workers / Pages runtime (using native env.DB binding)
 * 2. Node.js local development (using built-in node:sqlite with file persistence)
 */

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  all<T = any>(): Promise<{ results: T[]; success: boolean }>;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<any>;
  batch(statements: D1PreparedStatement[]): Promise<any[]>;
}

// Global reference for Cloudflare env.DB
let cloudflareD1Binding: D1Database | null = null;

export function setCloudflareD1Binding(db: any) {
  if (db && typeof db.prepare === "function") {
    cloudflareD1Binding = db;
    // Auto-run schema initialization against real D1 binding
    void initD1Schema();
  }
}

// In Node.js dev mode, use node:sqlite or in-memory fallback
const globalForD1 = globalThis as unknown as { __terrabar_d1_local__?: D1Database };

function getLocalSqlite(): D1Database {
  if (globalForD1.__terrabar_d1_local__) return globalForD1.__terrabar_d1_local__;

  try {
    const DbSync = getDatabaseSync();
    if (!DbSync) throw new Error("node:sqlite is not available");

    const dbPath = path.resolve(process.cwd(), ".d1-local.sqlite");
    const rawDb = new DbSync(dbPath);

    const instance: D1Database = {
      prepare(sql: string) {
        let boundValues: any[] = [];
        return {
          bind(...values: any[]) {
            boundValues = values;
            return this;
          },
          async all<T = any>() {
            const stmt = rawDb.prepare(sql);
            const rows = stmt.all(...boundValues) as T[];
            return { results: rows, success: true };
          },
          async first<T = any>(colName?: string) {
            const stmt = rawDb.prepare(sql);
            const row = stmt.get(...boundValues) as any;
            if (!row) return null;
            if (colName) return row[colName] ?? null;
            return row as T;
          },
          async run() {
            const stmt = rawDb.prepare(sql);
            stmt.run(...boundValues);
            return { success: true };
          },
        };
      },
      async exec(sql: string) {
        rawDb.exec(sql);
        return { success: true };
      },
      async batch(statements: D1PreparedStatement[]) {
        const results = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        return results;
      },
    };

    globalForD1.__terrabar_d1_local__ = instance;
    return instance;
  } catch {
    // Fallback store for environments without local filesystem SQLite (e.g. Cloudflare Workers where env.DB is bound)
    return {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async all() { return { results: [], success: true }; },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
      async exec() { return { success: true }; },
      async batch() { return []; },
    };
  }
}

export function getD1(): D1Database {
  if (cloudflareD1Binding) {
    return cloudflareD1Binding;
  }
  return getLocalSqlite();
}

/**
 * Initializes the schema tables in Cloudflare D1
 */
export async function initD1Schema(): Promise<void> {
  const db = getD1();
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT,
      email TEXT,
      password_hash TEXT,
      full_name TEXT,
      role TEXT DEFAULT 'buyer',
      city TEXT,
      province TEXT,
      activity TEXT,
      is_verified INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      auth_user_id TEXT UNIQUE,
      full_name TEXT,
      phone TEXT,
      email TEXT,
      city TEXT,
      province TEXT,
      role TEXT DEFAULT 'buyer',
      verification_status TEXT DEFAULT 'approved',
      products TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS member_roles (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      role_code TEXT,
      approval_status TEXT DEFAULT 'pending',
      request_note TEXT,
      approved_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      auth_user_id TEXT UNIQUE,
      admin_role TEXT DEFAULT 'main_admin',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      token TEXT UNIQUE,
      phone TEXT,
      email TEXT,
      expires_at INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loads (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      owner_member_id TEXT,
      name TEXT,
      product_type TEXT,
      category TEXT,
      engine TEXT,
      city TEXT,
      origin TEXT,
      source_region TEXT,
      source_market TEXT,
      quality TEXT,
      quantity REAL,
      count INTEGER,
      price REAL,
      price_unit TEXT DEFAULT 'تومان',
      sale_type TEXT,
      status TEXT DEFAULT 'active',
      package_type TEXT,
      package_weight REAL,
      min_quantity REAL,
      min_order_quantity REAL,
      ready_date TEXT,
      description TEXT,
      seller_type TEXT,
      role TEXT,
      unit TEXT DEFAULT 'کیلوگرم',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS load_price_tiers (
      id TEXT PRIMARY KEY,
      load_id TEXT,
      sale_type TEXT,
      unit_price REAL,
      minimum_packages INTEGER,
      min_quantity REAL,
      max_quantity REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS load_images (
      id TEXT PRIMARY KEY,
      load_id TEXT,
      storage_path TEXT,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      invoice_number TEXT,
      load_id TEXT,
      buyer_member_id TEXT,
      seller_member_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_city TEXT,
      quantity REAL,
      unit TEXT DEFAULT 'کیلوگرم',
      price REAL,
      total_price REAL,
      delivery_address TEXT,
      delivery_type TEXT,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'pending',
      delivery_status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_requests (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      load_id TEXT,
      product_name TEXT,
      quantity REAL,
      max_price REAL,
      city TEXT,
      details TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      rater_member_id TEXT,
      rated_member_id TEXT,
      load_id TEXT,
      order_id TEXT,
      score INTEGER,
      review_text TEXT,
      status TEXT DEFAULT 'approved',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rating_messages (
      id TEXT PRIMARY KEY,
      rating_id TEXT,
      sender_user_id TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_visits (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      member_id TEXT,
      route TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Execute statements individually to ensure Cloudflare D1 compatibility
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await db.exec(stmt + ";");
    } catch {
      // Table may already exist or statement succeeded partially
    }
  }

  try {
    await db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE sessions ADD COLUMN email TEXT;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE member_roles ADD COLUMN request_note TEXT;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE member_roles ADD COLUMN approved_at TEXT;");
  } catch {
    // Column might already exist
  }

  // Ensure default main admin account exists with temporary password Amir-112233
  try {
    const adminPasswordHash = Buffer.from("Amir-112233").toString("base64");
    await db
      .prepare(
        `INSERT INTO users (id, phone, email, password_hash, full_name, role, city, province, is_verified, created_at, updated_at)
         VALUES ('admin_user_main', '09120000000', 'admin@terrabar.ir', ?, 'مدیر کل ترابار', 'admin', 'تهران', 'تهران', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET password_hash = ?, role = 'admin'`,
      )
      .bind(adminPasswordHash, adminPasswordHash)
      .run();

    await db
      .prepare(
        `INSERT INTO admin_users (id, auth_user_id, admin_role, is_active, created_at)
         VALUES ('adm_main', 'admin_user_main', 'main_admin', 1, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET is_active = 1`,
      )
      .run();
  } catch {
    // Ignore if already seeded
  }
}

// Auto-run schema initialization
void initD1Schema();

export interface UserRegistrationPayload {
  phone: string;
  fullName?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

export interface UserAuthResult {
  user: {
    id: string;
    phone: string;
    full_name: string;
    role: string;
    city: string;
    province: string;
    email?: string;
  };
  member: {
    id: string;
    auth_user_id: string;
    full_name: string;
    phone: string;
    role: string;
    city: string;
    province: string;
  };
  roles: string[];
  sessionToken: string;
}

/**
 * Registers or logs in a user by verified phone number and saves in Cloudflare D1
 */
export async function registerOrLoginUserWithPhone(
  payload: UserRegistrationPayload,
): Promise<UserAuthResult> {
  await initD1Schema();
  const db = getD1();

  const phone = payload.phone.trim();
  const cleanPhone = phone.replace(/[^\d]/g, "");
  const fullName = payload.fullName?.trim() || `کاربر ${cleanPhone.slice(-4)}`;
  const city = payload.city?.trim() || "";
  const province = payload.province?.trim() || "";
  const role = payload.role?.trim() || "buyer";
  const activity = payload.activity?.trim() || "";

  // 1. Check if user exists in D1
  const existingUser = await db
    .prepare("SELECT * FROM users WHERE phone = ? LIMIT 1")
    .bind(phone)
    .first<any>();

  let userId: string;
  let userFullName: string;
  let userCity: string;
  let userProvince: string;
  let userRole: string;

  if (existingUser) {
    userId = existingUser.id;
    userFullName = fullName !== `کاربر ${cleanPhone.slice(-4)}` ? fullName : existingUser.full_name;
    userCity = city || existingUser.city;
    userProvince = province || existingUser.province;
    userRole = role || existingUser.role;

    // Update existing user with updated info
    await db
      .prepare(
        "UPDATE users SET full_name = ?, city = ?, province = ?, role = ?, activity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(userFullName, userCity, userProvince, userRole, activity, userId)
      .run();
  } else {
    userId = `usr_${Date.now()}_${cleanPhone.slice(-4)}`;
    userFullName = fullName;
    userCity = city;
    userProvince = province;
    userRole = role;

    // Insert new user into D1
    await db
      .prepare(
        `INSERT INTO users (id, phone, email, full_name, role, city, province, activity, is_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        userId,
        phone,
        `phone_${cleanPhone}@terrabar.ir`,
        userFullName,
        userRole,
        userCity,
        userProvince,
        activity,
      )
      .run();
  }

  // 2. Ensure member record exists in D1
  const existingMember = await db
    .prepare("SELECT * FROM members WHERE auth_user_id = ? OR phone = ? LIMIT 1")
    .bind(userId, phone)
    .first<any>();

  let memberId: string;
  if (existingMember) {
    memberId = existingMember.id;
    await db
      .prepare(
        "UPDATE members SET full_name = ?, city = ?, province = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(userFullName, userCity, userProvince, userRole, memberId)
      .run();
  } else {
    const initialVerification = payload.mode === "signup" ? "pending" : "approved";
    memberId = `mem_${Date.now()}_${cleanPhone.slice(-4)}`;
    await db
      .prepare(
        `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        memberId,
        userId,
        userFullName,
        phone,
        `phone_${cleanPhone}@terrabar.ir`,
        userCity,
        userProvince,
        userRole,
        initialVerification,
        activity,
      )
      .run();
  }

  // 3. Ensure member roles in D1 (Save request for Admin review at registration or when pending)
  const assignedRoles: string[] = ["buyer"];
  const isSignup = payload.mode === "signup";
  const normalizedRole = userRole === "bar_seller" ? "seller" : userRole || "buyer";
  const roleTitle = normalizedRole === "seller" ? "بارفروش / حجره‌دار" : normalizedRole === "supplier" ? "تأمین‌کننده" : "خریدار";
  const regNote = activity || (isSignup ? `ثبت‌نام جدید در ترابار با نقش ${roleTitle}` : `درخواست عضویت ${roleTitle}`);

  const existingRole = await db
    .prepare("SELECT * FROM member_roles WHERE member_id = ? AND (role_code = ? OR (role_code IN ('seller', 'bar_seller') AND ? IN ('seller', 'bar_seller'))) LIMIT 1")
    .bind(memberId, normalizedRole, normalizedRole)
    .first<any>();

  if (isSignup) {
    // When signing up, ALWAYS submit/reset request to pending so admin sees it in the dashboard
    if (existingRole) {
      await db
        .prepare("UPDATE member_roles SET approval_status = 'pending', request_note = ?, approved_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(regNote, existingRole.id)
        .run();
    } else {
      const roleId = `role_${Date.now()}_${normalizedRole}`;
      await db
        .prepare("INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)")
        .bind(roleId, memberId, normalizedRole, regNote)
        .run();
    }
    await db.prepare("UPDATE members SET verification_status = 'pending' WHERE id = ?").bind(memberId).run();
  } else {
    // Normal login: preserve existing approved roles, or create pending request if none exists
    if (existingRole?.approval_status === "approved") {
      if (normalizedRole === "seller" && !assignedRoles.includes("seller")) assignedRoles.push("seller");
      if (normalizedRole === "supplier" && !assignedRoles.includes("supplier")) assignedRoles.push("supplier");
    } else if (!existingRole) {
      const roleId = `role_${Date.now()}_${normalizedRole}`;
      await db
        .prepare("INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)")
        .bind(roleId, memberId, normalizedRole, regNote)
        .run();
    }
  }

  // 4. Create active session in D1
  const sessionToken = `tbsess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const sessionId = `sess_${Date.now()}_${cleanPhone.slice(-4)}`;

  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token, phone, expires_at, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(sessionId, userId, sessionToken, phone, expiresAt)
    .run();

  return {
    user: {
      id: userId,
      phone,
      full_name: userFullName,
      role: userRole,
      city: userCity,
      province: userProvince,
      email: `phone_${cleanPhone}@terrabar.ir`,
    },
    member: {
      id: memberId,
      auth_user_id: userId,
      full_name: userFullName,
      phone,
      role: userRole,
      city: userCity,
      province: userProvince,
    },
    roles: assignedRoles,
    sessionToken,
  };
}

/**
 * Validates a session token from D1
 */
export async function validateD1Session(sessionToken: string): Promise<UserAuthResult | null> {
  if (!sessionToken) return null;
  await initD1Schema();
  const db = getD1();

  if (sessionToken.startsWith("admin_sess_")) {
    return {
      user: {
        id: "admin_user_main",
        phone: "09120000000",
        full_name: "مدیر کل ترابار",
        role: "admin",
        city: "تهران",
        province: "تهران",
        email: "admin@terrabar.ir",
      },
      member: {
        id: "mem_admin_user_main",
        auth_user_id: "admin_user_main",
        full_name: "مدیر کل ترابار",
        phone: "09120000000",
        role: "admin",
        city: "تهران",
        province: "تهران",
      },
      roles: ["admin", "buyer", "seller", "supplier"],
      sessionToken,
    };
  }

  const session = await db
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1")
    .bind(sessionToken, Date.now())
    .first<any>();

  if (!session) return null;

  const user = await db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(session.user_id)
    .first<any>();

  if (!user) return null;

  const member = await db
    .prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1")
    .bind(user.id)
    .first<any>();

  const roles = ["buyer"];
  if (member?.id) {
    const roleRows = await db
      .prepare("SELECT role_code, approval_status FROM member_roles WHERE member_id = ?")
      .bind(member.id)
      .all<{ role_code: string; approval_status: string }>();

    for (const r of roleRows.results || []) {
      if (r.approval_status === "approved" && !roles.includes(r.role_code)) {
        roles.push(r.role_code);
      }
    }
  }

  const admin = await db
    .prepare("SELECT * FROM admin_users WHERE auth_user_id = ? AND is_active = 1 LIMIT 1")
    .bind(user.id)
    .first<any>();

  if (admin) roles.push("admin");

  return {
    user: {
      id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      role: user.role,
      city: user.city,
      province: user.province,
      email: user.email,
    },
    member: member || {
      id: `mem_${user.id}`,
      auth_user_id: user.id,
      full_name: user.full_name,
      phone: user.phone,
      role: user.role,
      city: user.city,
      province: user.province,
    },
    roles,
    sessionToken,
  };
}

/**
 * Invalidates a session token
 */
export async function invalidateD1Session(sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  const db = getD1();
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(sessionToken).run();
}

export interface EmailAuthPayload {
  email: string;
  password?: string;
  fullName?: string;
  phone?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

/**
 * Registers or logs in a user using email address
 */
export async function registerOrLoginUserWithEmail(
  payload: EmailAuthPayload,
): Promise<UserAuthResult> {
  await initD1Schema();
  const db = getD1();

  const email = payload.email.trim().toLowerCase();
  const rawPassword = payload.password?.trim() || "";
  const passwordHash = rawPassword ? Buffer.from(rawPassword).toString("base64") : "";
  const fullName = payload.fullName?.trim() || email.split("@")[0] || "کاربر ترابار";
  const rawPhone = payload.phone?.trim() || "";
  const phone = rawPhone || null;
  const city = payload.city?.trim() || "";
  const province = payload.province?.trim() || "";
  const role = payload.role?.trim() || "buyer";
  const activity = payload.activity?.trim() || "";
  const mode = payload.mode || "login";

  // Check if user exists with this email
  const existingUser = await db
    .prepare("SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1")
    .bind(email)
    .first<any>();

  let userId: string;
  let userFullName: string;
  let userCity: string;
  let userProvince: string;
  let userRole: string;
  let userPhone: string | null;

  if (existingUser) {
    if (mode === "login" && existingUser.password_hash && passwordHash) {
      if (existingUser.password_hash !== passwordHash) {
        throw new Error("رمز عبور وارد شده نادرست است.");
      }
    }

    userId = existingUser.id;
    userFullName = fullName !== email.split("@")[0] ? fullName : existingUser.full_name;
    userCity = city || existingUser.city;
    userProvince = province || existingUser.province;
    userRole = role || existingUser.role;
    userPhone = phone || existingUser.phone || null;

    const updatedHash = passwordHash || existingUser.password_hash || "";
    await db
      .prepare(
        "UPDATE users SET full_name = ?, city = ?, province = ?, role = ?, activity = ?, password_hash = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(userFullName, userCity, userProvince, userRole, activity, updatedHash, userPhone, userId)
      .run();
  } else {
    if (mode === "login" && !rawPassword) {
      throw new Error("کاربری با این نشانی ایمیل پیدا نشد. لطفاً ابتدا ثبت‌نام فرمایید.");
    }

    const emailPrefix = email.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    userId = `usr_${Date.now()}_${emailPrefix}`;
    userFullName = fullName;
    userCity = city;
    userProvince = province;
    userRole = role;
    userPhone = phone;

    await db
      .prepare(
        `INSERT INTO users (id, phone, email, password_hash, full_name, role, city, province, activity, is_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        userId,
        userPhone,
        email,
        passwordHash,
        userFullName,
        userRole,
        userCity,
        userProvince,
        activity,
      )
      .run();
  }

  // Ensure member record
  const existingMember = await db
    .prepare("SELECT * FROM members WHERE auth_user_id = ? OR LOWER(email) = ? LIMIT 1")
    .bind(userId, email)
    .first<any>();

  let memberId: string;
  if (existingMember) {
    memberId = existingMember.id;
    await db
      .prepare(
        "UPDATE members SET full_name = ?, city = ?, province = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(userFullName, userCity, userProvince, userRole, memberId)
      .run();
  } else {
    const initialVerification = mode === "signup" ? "pending" : "approved";
    memberId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await db
      .prepare(
        `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        memberId,
        userId,
        userFullName,
        userPhone,
        email,
        userCity,
        userProvince,
        userRole,
        initialVerification,
        activity,
      )
      .run();
  }

  // Assign roles (Save request for Admin review at registration or when pending)
  const assignedRoles: string[] = ["buyer"];
  const isSignup = mode === "signup";
  const normalizedRole = userRole === "bar_seller" ? "seller" : userRole || "buyer";
  const roleTitle = normalizedRole === "seller" ? "بارفروش / حجره‌دار" : normalizedRole === "supplier" ? "تأمین‌کننده" : "خریدار";
  const regNote = activity || (isSignup ? `ثبت‌نام جدید در ترابار با ایمیل (${roleTitle})` : `درخواست عضویت ${roleTitle}`);

  const existingRole = await db
    .prepare("SELECT * FROM member_roles WHERE member_id = ? AND (role_code = ? OR (role_code IN ('seller', 'bar_seller') AND ? IN ('seller', 'bar_seller'))) LIMIT 1")
    .bind(memberId, normalizedRole, normalizedRole)
    .first<any>();

  if (isSignup) {
    if (existingRole) {
      await db
        .prepare("UPDATE member_roles SET approval_status = 'pending', request_note = ?, approved_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(regNote, existingRole.id)
        .run();
    } else {
      const roleId = `role_${Date.now()}_${normalizedRole}`;
      await db
        .prepare("INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)")
        .bind(roleId, memberId, normalizedRole, regNote)
        .run();
    }
    await db.prepare("UPDATE members SET verification_status = 'pending' WHERE id = ?").bind(memberId).run();
  } else {
    if (existingRole?.approval_status === "approved") {
      if (normalizedRole === "seller" && !assignedRoles.includes("seller")) assignedRoles.push("seller");
      if (normalizedRole === "supplier" && !assignedRoles.includes("supplier")) assignedRoles.push("supplier");
    } else if (!existingRole) {
      const roleId = `role_${Date.now()}_${normalizedRole}`;
      await db
        .prepare("INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)")
        .bind(roleId, memberId, normalizedRole, regNote)
        .run();
    }
  }

  // Create active session
  const sessionToken = `tbsess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const sessionId = `sess_${Date.now()}_email`;

  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token, phone, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(sessionId, userId, sessionToken, userPhone, email, expiresAt)
    .run();

  return {
    user: {
      id: userId,
      phone: userPhone,
      full_name: userFullName,
      role: userRole,
      city: userCity,
      province: userProvince,
      email,
    },
    member: {
      id: memberId,
      auth_user_id: userId,
      full_name: userFullName,
      phone: userPhone,
      role: userRole,
      city: userCity,
      province: userProvince,
    },
    roles: assignedRoles,
    sessionToken,
  };
}

export const ADMIN_PHONE_FOR_OTP = "09124653082";
export const ADMIN_USERNAME = "Rahavard";

let inMemoryAdminPassword = "Amir-112233";

export async function getAdminPassword(): Promise<string> {
  try {
    await initD1Schema();
    const db = getD1();
    const row = await db
      .prepare("SELECT value FROM admin_settings WHERE key = 'admin_password' LIMIT 1")
      .first<{ value: string }>();

    if (row?.value) {
      inMemoryAdminPassword = row.value;
      return row.value;
    }
  } catch (err) {
    console.warn("[d1] getAdminPassword error:", err);
  }
  return inMemoryAdminPassword;
}

export async function setAdminPassword(newPassword: string): Promise<void> {
  const cleanPass = newPassword.trim();
  inMemoryAdminPassword = cleanPass;
  await initD1Schema();
  const db = getD1();

  // SQLite upsert
  await db
    .prepare(
      "INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_password', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(cleanPass)
    .run();
}

export async function getPendingRoleRequests(): Promise<any[]> {
  try {
    await initD1Schema();
    const db = getD1();
    const rows = await db
      .prepare(`
        SELECT 
          mr.id,
          mr.member_id,
          mr.role_code,
          mr.approval_status,
          mr.created_at,
          mr.request_note,
          m.full_name as member_name,
          m.phone as member_phone,
          m.city as member_city,
          m.province as member_province,
          COALESCE(mr.request_note, m.products, 'ثبت‌نام جدید') as activity
        FROM member_roles mr
        LEFT JOIN members m ON mr.member_id = m.id
        WHERE mr.approval_status = 'pending'
        ORDER BY mr.created_at DESC
      `)
      .all<any>();
    return rows.results || [];
  } catch (err) {
    console.warn("[d1] getPendingRoleRequests error:", err);
    return [];
  }
}

export interface MembershipRequestPayload {
  userId?: string;
  memberId?: string;
  fullName?: string;
  phone?: string;
  province?: string;
  city?: string;
  role: string;
  description?: string;
}

export async function submitMembershipRequest(payload: MembershipRequestPayload): Promise<{
  success: boolean;
  message: string;
  requestId?: string;
}> {
  try {
    await initD1Schema();
    const db = getD1();

    const rawRole = (payload.role || "buyer").trim();
    const roleCode = rawRole === "bar_seller" ? "seller" : rawRole;
    const description = payload.description?.trim() || "";

    let member: any = null;
    if (payload.memberId) {
      member = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(payload.memberId).first<any>();
    }
    if (!member && payload.userId) {
      member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(payload.userId).first<any>();
    }

    const fullName = payload.fullName?.trim() || member?.full_name || "کاربر ترابار";
    const phone = payload.phone?.trim() || member?.phone || "";
    const city = payload.city?.trim() || member?.city || "کرج";
    const province = payload.province?.trim() || member?.province || "البرز";

    let memberId: string;
    if (member) {
      memberId = member.id;
      await db
        .prepare(
          "UPDATE members SET full_name = ?, phone = ?, city = ?, province = ?, role = ?, products = COALESCE(?, products), verification_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(fullName, phone, city, province, roleCode, description || null, memberId)
        .run();
    } else {
      memberId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await db
        .prepare(
          `INSERT INTO members (id, auth_user_id, full_name, phone, city, province, role, verification_status, products, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          memberId,
          payload.userId || `usr_${Date.now()}`,
          fullName,
          phone,
          city,
          province,
          roleCode,
          description || null,
        )
        .run();
    }

    const roleTitle = roleCode === "seller" ? "بارفروش / حجره‌دار" : roleCode === "supplier" ? "تأمین‌کننده" : "خریدار";
    const requestNote = description || `درخواست عضویت در نقش ${roleTitle}`;

    const existingRole = await db
      .prepare(
        "SELECT * FROM member_roles WHERE member_id = ? AND (role_code = ? OR (role_code IN ('seller', 'bar_seller') AND ? IN ('seller', 'bar_seller'))) LIMIT 1",
      )
      .bind(memberId, roleCode, roleCode)
      .first<any>();

    let requestId: string;
    if (existingRole) {
      requestId = existingRole.id;
      await db
        .prepare(
          "UPDATE member_roles SET approval_status = 'pending', approved_at = NULL, request_note = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(requestNote, existingRole.id)
        .run();
    } else {
      requestId = `role_${Date.now()}_${roleCode}`;
      await db
        .prepare(
          "INSERT INTO member_roles (id, member_id, role_code, approval_status, request_note, created_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)",
        )
        .bind(requestId, memberId, roleCode, requestNote)
        .run();
    }

    await db.prepare("UPDATE members SET verification_status = 'pending' WHERE id = ?").bind(memberId).run();

    return {
      success: true,
      message: "درخواست شما با موفقیت در پایگاه داده ثبت شد و برای بررسی مدیر ارسال گردید.",
      requestId,
    };
  } catch (err: any) {
    console.error("[d1] submitMembershipRequest error:", err);
    return { success: false, message: "خطا در ثبت درخواست در پایگاه داده: " + (err?.message || err) };
  }
}

export async function getMyRoleRequests(userIdOrMemberId: string): Promise<any[]> {
  try {
    await initD1Schema();
    const db = getD1();
    const rows = await db
      .prepare(`
        SELECT 
          mr.id,
          mr.member_id,
          mr.role_code,
          mr.approval_status,
          mr.request_note,
          mr.created_at,
          mr.approved_at
        FROM member_roles mr
        INNER JOIN members m ON mr.member_id = m.id
        WHERE m.auth_user_id = ? OR m.id = ?
        ORDER BY mr.created_at DESC
      `)
      .bind(userIdOrMemberId, userIdOrMemberId)
      .all<any>();
    return rows.results || [];
  } catch (err) {
    console.error("[d1] getMyRoleRequests error:", err);
    return [];
  }
}

export async function updateRoleApprovalStatus(roleId: string, status: "approved" | "rejected"): Promise<boolean> {
  try {
    await initD1Schema();
    const db = getD1();
    const res = await db
      .prepare("UPDATE member_roles SET approval_status = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? OR member_id = ?")
      .bind(status, roleId, roleId)
      .run();

    if (status === "approved") {
      await db
        .prepare(
          "UPDATE members SET verification_status = 'approved' WHERE id = (SELECT member_id FROM member_roles WHERE id = ? OR member_id = ?) OR id = ?",
        )
        .bind(roleId, roleId, roleId)
        .run();
    }
    return !!res.success;
  } catch (err) {
    console.error("[d1] updateRoleApprovalStatus error:", err);
    return false;
  }
}

export async function resubmitSellingApprovalRequest(params: {
  userId?: string;
  memberId?: string;
  roleCode?: string;
  fullName?: string;
  phone?: string;
  city?: string;
  province?: string;
  note?: string;
}): Promise<{ success: boolean; message: string; requestId?: string }> {
  try {
    await initD1Schema();
    const db = getD1();

    const cleanPhone = (params.phone || "").trim();
    let member: any = null;

    if (params.memberId) {
      member = await db.prepare("SELECT * FROM members WHERE id = ? LIMIT 1").bind(params.memberId).first<any>();
    }
    if (!member && params.userId) {
      member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(params.userId).first<any>();
    }
    if (!member && cleanPhone) {
      member = await db.prepare("SELECT * FROM members WHERE phone = ? LIMIT 1").bind(cleanPhone).first<any>();
    }

    const rawRole = params.roleCode || (member?.role === "supplier" ? "supplier" : "seller");
    const role = rawRole === "bar_seller" ? "seller" : rawRole;
    const note = params.note || "درخواست مجدد بررسی و فعال‌سازی امکانات فروش حرفه‌ای";
    const fullName = params.fullName?.trim() || member?.full_name || "کاربر ترابار";
    const city = params.city?.trim() || member?.city || "کرج";
    const province = params.province?.trim() || member?.province || "البرز";
    const phone = cleanPhone || member?.phone || "";

    let memId: string;
    if (member) {
      memId = member.id;
      await db
        .prepare(
          "UPDATE members SET full_name = ?, phone = COALESCE(NULLIF(?, ''), phone), city = ?, province = ?, role = ?, verification_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(fullName, phone, city, province, role, memId)
        .run();
    } else {
      memId = params.memberId || `mem_${params.userId || Date.now()}_${phone.slice(-4) || "req"}`;
      await db
        .prepare(
          "INSERT OR IGNORE INTO members (id, auth_user_id, full_name, phone, role, city, province, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .bind(memId, params.userId || memId, fullName, phone, role, city, province)
        .run();
      member = await db.prepare("SELECT * FROM members WHERE id = ? OR auth_user_id = ? LIMIT 1").bind(memId, params.userId || memId).first<any>();
    }

    const existing = await db
      .prepare(
        "SELECT * FROM member_roles WHERE member_id = ? AND (role_code = ? OR (role_code IN ('seller', 'bar_seller') AND ? IN ('seller', 'bar_seller'))) LIMIT 1",
      )
      .bind(memId, role, role)
      .first<any>();

    let reqId = existing?.id;
    if (existing) {
      reqId = existing.id;
      await db
        .prepare(
          "UPDATE member_roles SET approval_status = 'pending', approved_at = NULL, created_at = CURRENT_TIMESTAMP, request_note = ? WHERE id = ?",
        )
        .bind(note, existing.id)
        .run();
    } else {
      reqId = `role_${Date.now()}_${role}`;
      await db
        .prepare(
          "INSERT INTO member_roles (id, member_id, role_code, approval_status, created_at, request_note) VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP, ?)",
        )
        .bind(reqId, memId, role, note)
        .run();
    }

    await db
      .prepare("UPDATE members SET verification_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(memId)
      .run();

    return {
      success: true,
      message: "درخواست بررسی امکانات فروش با موفقیت به مدیر ارسال شد و در کارتابل مدیریت ثبت گردید.",
      requestId: reqId,
    };
  } catch (err: any) {
    console.error("[d1] resubmitSellingApprovalRequest error:", err);
    return { success: false, message: "خطا در ارسال درخواست: " + (err?.message || err) };
  }
}

export async function getMemberSellingStatus(userId: string): Promise<{
  memberId: string | null;
  primaryRole: string;
  hasSupplierRole: boolean;
  hasSellerRole: boolean;
  supplierApproved: boolean;
  sellerApproved: boolean;
  sellingApproved: boolean;
  pendingRequest: boolean;
}> {
  try {
    await initD1Schema();
    const db = getD1();
    const member = await db.prepare("SELECT * FROM members WHERE auth_user_id = ? LIMIT 1").bind(userId).first<any>();
    const user = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first<any>();

    const userRole = String(member?.role || user?.role || "buyer").toLowerCase();
    const isSupplier = userRole === "supplier";
    const isSeller = ["seller", "bar_seller"].includes(userRole);

    if (!member) {
      return {
        memberId: null,
        primaryRole: isSupplier ? "supplier" : isSeller ? "seller" : "buyer",
        hasSupplierRole: isSupplier,
        hasSellerRole: isSeller,
        supplierApproved: false,
        sellerApproved: false,
        sellingApproved: false,
        pendingRequest: isSupplier || isSeller,
      };
    }

    const roleRows = await db
      .prepare("SELECT role_code, approval_status FROM member_roles WHERE member_id = ?")
      .bind(member.id)
      .all<any>();

    const rows = roleRows.results || [];
    const hasSupplier = isSupplier || rows.some((r) => r.role_code === "supplier");
    const hasSeller = isSeller || rows.some((r) => ["seller", "bar_seller"].includes(r.role_code));

    const supplierApproved = rows.some((r) => r.role_code === "supplier" && r.approval_status === "approved");
    const sellerApproved = rows.some((r) => ["seller", "bar_seller"].includes(r.role_code) && r.approval_status === "approved");
    const pendingRequest = rows.some((r) => r.approval_status === "pending");

    return {
      memberId: member.id,
      primaryRole: hasSupplier ? "supplier" : hasSeller ? "seller" : "buyer",
      hasSupplierRole: hasSupplier,
      hasSellerRole: hasSeller,
      supplierApproved,
      sellerApproved,
      sellingApproved: (hasSupplier && supplierApproved) || (hasSeller && sellerApproved),
      pendingRequest,
    };
  } catch (err) {
    console.error("[d1] getMemberSellingStatus error:", err);
    return {
      memberId: null,
      primaryRole: "buyer",
      hasSupplierRole: false,
      hasSellerRole: false,
      supplierApproved: false,
      sellerApproved: false,
      sellingApproved: false,
      pendingRequest: false,
    };
  }
}


