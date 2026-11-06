/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server-side D1 Database proxy
 * Database ID: 9da7735b-e4c9-4f7f-9abe-53ba1545c60e
 */
import { getD1 } from "@/lib/d1-database";

export const supabaseAdmin: any = {
  from(tableName: string) {
    const db = getD1();
    return {
      select() { return this; },
      eq() { return this; },
      async single() { return { data: null, error: null }; },
      async maybeSingle() { return { data: null, error: null }; },
      async insert(data: any) { return { data, error: null }; },
      async update(data: any) { return { data, error: null }; },
      async delete() { return { data: null, error: null }; },
    };
  },
};
