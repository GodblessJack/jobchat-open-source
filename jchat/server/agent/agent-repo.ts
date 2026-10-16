// jchat/server/agent/agent-repo.ts
//
// Read layer over jobchat's existing `agents` / `user_agents` / `agent_skills`
// tables. The actual schema (verified 2026-04-28) differs from the spec —
// authoritative columns are:
//   agents:       id, name, role, avatar_url, persona_description,
//                 initial_message, is_default, created_at, updated_at
//   user_agents:  id, user_id, agent_id, custom_instructions, is_removable,
//                 last_read_at, created_at  (UNIQUE(user_id, agent_id))
//   agent_skills: id, agent_id, skill_name, description, enabled, sort_order
//
// jchat treats these tables as READ-ONLY (jobchat owns writes via its own
// admin UI / contact-recommender skill). All listing/lookup goes through
// the service-role client to bypass RLS — the JWT verification middleware
// is the trust boundary.

import type { AgentDetail, AgentSummary, AgentIdentity, AgentSkillView, Uuid } from '@shared/domain.js';
import { ErrorCodes, JchatError } from '@shared/errors.js';
import { db } from '../lib/db.js';
import { agents, userAgents, agentSkills } from '../sql/schema/index.js';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { logger } from '../logger.js';

interface AgentRow {
  id: string;
  name: string;
  role: string | null;
  avatarUrl: string | null;
  personaDescription: string | null;
  initialMessage: string | null;
  isDefault: boolean | null;
  identity: AgentIdentity | null;
  bootstrapMd: string | null;
  lastReadAt: Date | null;
}

function toSummary(row: AgentRow): AgentSummary {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl,
    description: row.role,
    lastReadAt: row.lastReadAt?.toISOString() ?? null
  };
}

/**
 * List the Agents that the given user has a `user_agents` row for.
 * Returns a stable, name-sorted list. Empty array on miss / error
 * (caller decides how to surface the empty state).
 */
export async function listAgentsForUser(userId: Uuid): Promise<AgentSummary[]> {
  const rows = await db
    .select({
      agentId: userAgents.agentId,
      customInstructions: userAgents.customInstructions,
      isRemovable: userAgents.isRemovable,
      lastReadAt: userAgents.lastReadAt,
      // agent columns
      id: agents.id,
      name: agents.name,
      role: agents.role,
      avatarUrl: agents.avatarUrl,
      personaDescription: agents.personaDescription,
      initialMessage: agents.initialMessage,
      isDefault: agents.isDefault,
      identity: agents.identity,
      bootstrapMd: agents.bootstrapMd,
    })
    .from(userAgents)
    .innerJoin(agents, eq(userAgents.agentId, agents.id))
    .where(and(eq(userAgents.userId, userId), isNull(userAgents.deletedAt)))
    .catch((err) => {
      logger.error({ err, userId }, 'listAgentsForUser failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];

  const out: AgentSummary[] = [];
  for (const r of rows) {
    if (r.id) {
      out.push(toSummary({
        id: r.id,
        name: r.name,
        role: r.role,
        avatarUrl: r.avatarUrl,
        personaDescription: r.personaDescription,
        initialMessage: r.initialMessage,
        isDefault: r.isDefault,
        identity: r.identity as AgentIdentity | null,
        bootstrapMd: r.bootstrapMd,
        lastReadAt: r.lastReadAt,
      }));
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Fetch a single Agent (no user-scoping). Returns null if not found.
 */
export async function getAgent(agentId: Uuid): Promise<AgentDetail | null> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      avatarUrl: agents.avatarUrl,
      personaDescription: agents.personaDescription,
      initialMessage: agents.initialMessage,
      isDefault: agents.isDefault,
      identity: agents.identity,
      bootstrapMd: agents.bootstrapMd,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
    .catch((err) => {
      logger.error({ err, agentId }, 'getAgent failed');
      return [];
    });

  if (!Array.isArray(rows)) return null;
  const row = rows[0];
  if (!row) return null;
  const skills = await getActiveSkillsForAgent(agentId);
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl,
    description: row.role,
    personaMarkdown: row.personaDescription,
    customInstructions: null,
    activeSkills: skills.map((s) => s.name),
    identity: row.identity as AgentIdentity | null,
    bootstrapMd: row.bootstrapMd,
    initialMessage: row.initialMessage
  };
}

/**
 * Get a per-(user,agent) Agent detail: agent base record + the user's
 * custom_instructions (from user_agents) + active skills.
 *
 * If the (user, agent) row does not exist, custom_instructions is null
 * but the Agent record is still returned (caller can decide whether to
 * surface a "not your contact yet" UX).
 */
export async function getAgentForUser(
  userId: Uuid,
  agentId: Uuid
): Promise<AgentDetail | null> {
  const detail = await getAgent(agentId);
  if (!detail) return null;
  const rows = await db
    .select({ customInstructions: userAgents.customInstructions })
    .from(userAgents)
    .where(and(
      eq(userAgents.userId, userId),
      eq(userAgents.agentId, agentId),
      isNull(userAgents.deletedAt)
    ))
    .limit(1)
    .catch((err) => {
      logger.error({ err, userId, agentId }, 'getAgentForUser ua-lookup failed');
      return [];
    });

  return {
    ...detail,
    customInstructions: (Array.isArray(rows) ? rows[0]?.customInstructions ?? null : null)
  };
}

/**
 * One enabled skill bound to an agent. `inline_content !== null` means the
 * skill body is stored in the DB (private user-distilled skill); the
 * skill-loader writes it to the worker workspace at session start. `null`
 * means the skill exists as a folder under `server/skills/` and is
 * symlinked into the workspace (shared skill).
 */
export interface ActiveSkill {
  name: string;
  inline_content: string | null;
}

/**
 * Return active skills for the given agent, sorted by sort_order ascending.
 * Caller (skill-loader.materializeSkills) decides per-row whether to symlink
 * the shared skill folder or write the inline_content into the workspace.
 */
export async function getActiveSkillsForAgent(agentId: Uuid): Promise<ActiveSkill[]> {
  const rows = await db
    .select({
      skillName: agentSkills.skillName,
      inlineContent: agentSkills.inlineContent,
    })
    .from(agentSkills)
    .where(and(
      eq(agentSkills.agentId, agentId),
      eq(agentSkills.enabled, true)
    ))
    .orderBy(asc(agentSkills.sortOrder))
    .catch((err) => {
      if (err) logger.error({ err, agentId }, 'getActiveSkillsForAgent failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({ name: r.skillName, inline_content: r.inlineContent }));
}

/**
 * Visibility gate for the public `agent.skills.list` command.
 * Throws NOT_FOUND for both missing and not-visible agents — we never
 * leak the existence of agents owned by other users (anti-enumeration).
 *
 * Visible means: shared (owner_user_id IS NULL) OR owned by `userId`.
 */
export async function assertAgentVisibleToUser(
  userId: Uuid,
  agentId: Uuid
): Promise<void> {
  const rows = await db
    .select({ ownerUserId: agents.ownerUserId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (rows.length === 0) {
    throw new JchatError(ErrorCodes.NOT_FOUND, 'agent not found');
  }
  const ownerId = rows[0].ownerUserId;
  if (ownerId !== null && ownerId !== userId) {
    throw new JchatError(ErrorCodes.NOT_FOUND, 'agent not found');
  }
}

/**
 * Tokens forbidden in user-visible product strings (CLAUDE.md §
 * "产品话术红线"). Skill slugs are raw DB identifiers used at runtime —
 * if we render them directly they leak internal vocabulary into the UI.
 * Strip these tokens out when humanising.
 */
const REDLINE_TOKENS = new Set(['agent', 'mate', 'skill', 'worker', 'persona']);

/**
 * Turn a DB skill slug like `persona-distillation` into a user-facing
 * label. Hyphens become spaces, forbidden tokens are dropped, remaining
 * words are title-cased. Falls back to the raw slug if every token would
 * be filtered out (edge case — should never happen in practice).
 */
function humanizeSkillName(slug: string): string {
  const parts = slug
    .split('-')
    .filter((p) => p && !REDLINE_TOKENS.has(p.toLowerCase()));
  if (parts.length === 0) return slug;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/**
 * Read this agent's enabled skills as `AgentSkillView` rows. Used by the
 * `agent.skills.list` WS command to populate the DM-side AgentSkillsPanel.
 * Caller must have already passed `assertAgentVisibleToUser` — this fn
 * does NOT gate.
 *
 * `name` is humanised server-side (slug → title-case, redline tokens
 * stripped) so the FE renders only product-safe strings.
 */
export async function getAgentSkillViews(agentId: Uuid): Promise<AgentSkillView[]> {
  const rows = await db
    .select({
      skillName: agentSkills.skillName,
      description: agentSkills.description,
      sortOrder: agentSkills.sortOrder,
    })
    .from(agentSkills)
    .where(and(
      eq(agentSkills.agentId, agentId),
      eq(agentSkills.enabled, true)
    ))
    .orderBy(asc(agentSkills.sortOrder))
    .catch((err) => {
      if (err) logger.error({ err, agentId }, 'getAgentSkillViews failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    slug: r.skillName,
    name: humanizeSkillName(r.skillName),
    description: r.description,
    sortOrder: r.sortOrder ?? 0
  }));
}
