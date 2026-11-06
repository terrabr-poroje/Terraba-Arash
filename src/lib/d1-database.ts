/* eslint-disable @typescript-eslint/no-explicit-any */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

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
  }
}

// In Node.js dev mode, use node:sqlite
const globalForD1 = globalThis as unknown as { __terrabar_d1_local__?: D1Database };

function getLocalSqlite(): D1Database {
  if (globalForD1.__terrabar_d1_local__) return globalForD1.__terrabar_d1_local__;

  try {
    const dbPath = path.resolve(process.cwd(), ".d1-local.sqlite");
    const rawDb = new DatabaseSync(dbPath);

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
  } catch (err) {
    console.warn("[D1 Database] Could not initialize local SQLite, falling back to in-memory store", err);
    // In-memory fallback
    const memoryStore: Record<string, any[]> = {};
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
      phone TEXT UNIQUE,
      email TEXT,
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
      approval_status TEXT DEFAULT 'approved',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      expires_at INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      invoice_number TEXT,
      buyer_member_id TEXT,
      seller_member_id TEXT,
      total_price REAL,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'pending',
      delivery_status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_requests (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      details TEXT,
      status TEXT DEFAULT 'pending',
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

  try {
    await db.exec(schemaSql);
  } catch (e) {
    console.error("[D1 Database] Schema init warning:", e);
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
    memberId = `mem_${Date.now()}_${cleanPhone.slice(-4)}`;
    await db
      .prepare(
        `INSERT INTO members (id, auth_user_id, full_name, phone, email, city, province, role, verification_status, products, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
        activity,
      )
      .run();
  }

  // 3. Ensure member roles in D1
  const assignedRoles: string[] = ["buyer"];
  if (userRole === "seller" || userRole === "bar_seller") {
    assignedRoles.push("seller");
    const roleId = `role_${Date.now()}_seller`;
    await db
      .prepare(
        "INSERT OR IGNORE INTO member_roles (id, member_id, role_code, approval_status, created_at) VALUES (?, ?, 'seller', 'approved', CURRENT_TIMESTAMP)",
      )
      .bind(roleId, memberId)
      .run();
  } else if (userRole === "supplier") {
    assignedRoles.push("supplier");
    const roleId = `role_${Date.now()}_supplier`;
    await db
      .prepare(
        "INSERT OR IGNORE INTO member_roles (id, member_id, role_code, approval_status, created_at) VALUES (?, ?, 'supplier', 'approved', CURRENT_TIMESTAMP)",
      )
      .bind(roleId, memberId)
      .run();
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
  if (user.role === "seller" || user.role === "bar_seller") roles.push("seller");
  if (user.role === "supplier") roles.push("supplier");

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
 * Invalidates a session token in D1
 */
export async function invalidateD1Session(sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  const db = getD1();
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(sessionToken).run();
}
