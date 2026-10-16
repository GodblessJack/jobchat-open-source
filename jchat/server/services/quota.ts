// jchat/server/services/quota.ts
//
// Read-only daily distillation quota lookup. Increment is performed inside
// the create_distilled_contact stored function (spec §3.7) atomically with
// the agent insert — so this service never mutates state.
//
// Day boundary: UTC+8 (CN simplification for v1; revisit when global users
// arrive). Plan §Conventions also documents this.

import { db } from '../lib/db.js';
import { distillationQuota } from '../sql/schema/index.js';
import { eq, and } from 'drizzle-orm';

export interface QuotaInfo {
  allowed: boolean;
  used: number;
  limit: 3;
  reset_at: string;
}

const DAILY_LIMIT = 3 as const;
const CN_OFFSET_MS = 8 * 3600 * 1000;

function nextResetAt(): string {
  // Compute next UTC+8 midnight, return as UTC ISO timestamp.
  const now = new Date();
  const cn = new Date(now.getTime() + CN_OFFSET_MS);
  cn.setUTCHours(0, 0, 0, 0);
  cn.setUTCDate(cn.getUTCDate() + 1);
  return new Date(cn.getTime() - CN_OFFSET_MS).toISOString();
}

function todayDateString(): string {
  const cn = new Date(Date.now() + CN_OFFSET_MS);
  return cn.toISOString().slice(0, 10);
}

export async function getDistillationQuota(userId: string): Promise<QuotaInfo> {
  const today = todayDateString();
  const rows = await db
    .select({ count: distillationQuota.count })
    .from(distillationQuota)
    .where(and(
      eq(distillationQuota.userId, userId),
      eq(distillationQuota.date, today)
    ))
    .limit(1);

  const used = rows[0]?.count ?? 0;
  return {
    used,
    limit: DAILY_LIMIT,
    allowed: used < DAILY_LIMIT,
    reset_at: nextResetAt(),
  };
}
