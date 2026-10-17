// jchat/scripts/seed-local.mjs — idempotent local PostgreSQL agent seeding
// Creates default contacts, links capabilities, and grants access to the local user.
//
// Usage: node scripts/seed-local.mjs

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const username = process.env.JCHAT_LOCAL_USERNAME || 'admin';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in jchat/.env.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // 1. Find the configured local user
    const { rows: [localUser] } = await client.query(
      'SELECT id FROM local_users WHERE username = $1', [username]
    );
    if (!localUser) {
      console.error(`Local user "${username}" not found. Run npm run create-user first.`);
      process.exit(1);
    }
    console.log('Local user:', localUser.id);

    // 2. Create agents if not exist
    const agents = [
      { name: 'Karpathy', role: 'AI Researcher & Educator',
        persona: 'Andrej Karpathy is a renowned AI researcher, educator, and founding member of OpenAI. He is known for his deep technical expertise, clear explanations, and ability to make complex topics accessible.',
        slug: 'karpathy',
        skills: ['andrej-karpathy', 'content-research-writer'] },
      { name: 'Career Coach', role: 'Professional Career Advisor',
        persona: 'A comprehensive career advisor specializing in resume optimization, interview preparation, job market analysis, and career transitions. Provides actionable, structured feedback with a supportive yet honest tone.',
        slug: 'career-coach',
        skills: ['career-advisor'] },
      { name: 'Feynman', role: 'Physicist & Teacher',
        persona: 'Richard Feynman is a Nobel Prize-winning physicist known for his brilliant teaching style, insatiable curiosity, and ability to explain complex physics in simple, intuitive ways. He speaks with playfulness and a love for finding the joy in understanding.',
        slug: 'feynman',
        skills: ['feynman', 'content-research-writer'] },
    ];

    for (const a of agents) {
      // Only reuse shared default contacts. Never read, mutate, or grant access
      // to a same-slug private contact owned by another user.
      const { rows: matchingDefaults } = await client.query(
        `SELECT id FROM agents
         WHERE slug = $1 AND owner_user_id IS NULL AND is_default = true
         ORDER BY id`,
        [a.slug]
      );
      if (matchingDefaults.length > 1) {
        throw new Error(`Multiple shared default contacts found for slug: ${a.slug}`);
      }
      const [existing] = matchingDefaults;
      let agentId;
      if (existing) {
        agentId = existing.id;
        console.log(`Agent exists: ${a.name} (${agentId.slice(0,8)})`);
      } else {
        const { rows: [created] } = await client.query(
          `INSERT INTO agents (name, role, persona_description, slug, is_default)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [a.name, a.role, a.persona, a.slug]
        );
        agentId = created.id;
        console.log(`Created agent: ${a.name} (${agentId.slice(0,8)})`);
      }

      // Insert skills
      for (const skillName of a.skills) {
        const { rows: [sk] } = await client.query(
          'SELECT id FROM agent_skills WHERE agent_id = $1 AND skill_name = $2',
          [agentId, skillName]
        );
        if (!sk) {
          await client.query(
            'INSERT INTO agent_skills (agent_id, skill_name, description, enabled) VALUES ($1, $2, $3, true)',
            [agentId, skillName, `Skill: ${skillName}`]
          );
        }
      }

      // Link user
      const { rows: [ua] } = await client.query(
        'SELECT id FROM user_agents WHERE user_id = $1 AND agent_id = $2 AND deleted_at IS NULL',
        [localUser.id, agentId]
      );
      if (!ua) {
        await client.query(
          'INSERT INTO user_agents (user_id, agent_id, is_removable) VALUES ($1, $2, true)',
          [localUser.id, agentId]
        );
      }
    }

    // 3. Verify only the seeded shared defaults
    const { rows: summary } = await client.query(
      `SELECT a.name, a.slug,
         (SELECT count(*) FROM agent_skills WHERE agent_id = a.id) as skills,
         (SELECT count(*) FROM user_agents WHERE agent_id = a.id AND deleted_at IS NULL) as users
       FROM agents a
       WHERE a.slug = ANY($1::text[])
         AND a.owner_user_id IS NULL
         AND a.is_default = true
       ORDER BY a.name`,
      [agents.map(a => a.slug)]
    );
    console.log('\n=== Seed Summary ===');
    for (const s of summary) console.log(`  ${s.name}: ${s.skills} skills, ${s.users} users`);
    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
