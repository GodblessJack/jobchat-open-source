import 'dotenv/config';

function intEnv(key: string, def: number): number {
  const v = process.env[key];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  port: intEnv('JCHAT_PORT', 5272),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionsRoot: process.env.JCHAT_SESSIONS_ROOT || '/data/jchat-sessions',

  databaseUrl: process.env.DATABASE_URL || '',
  jwtAccessSecret: process.env.LOCAL_JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.LOCAL_JWT_REFRESH_SECRET || '',
  filesRoot: process.env.FILES_ROOT || '/data/jobchat/files',
  authTransition: process.env.AUTH_TRANSITION === '1',

  // Supabase env vars - only needed during AUTH_TRANSITION fallback
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseDbUrl: process.env.SUPABASE_DB_URL || '',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
  anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN || undefined,
  anthropicModel: process.env.ANTHROPIC_MODEL || undefined,

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,

  embeddingProvider: (process.env.JCHAT_EMBEDDING_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'stub-zero-vector')) as 'openai' | 'stub-zero-vector',
  embeddingModel: process.env.JCHAT_EMBEDDING_MODEL || 'text-embedding-3-small',
  embeddingDimension: intEnv('JCHAT_EMBEDDING_DIM', 1536),
  groupMemberLimit: intEnv('JCHAT_GROUP_MEMBER_LIMIT', 20),
  // Round-table is serial — at most ONE agent actively streaming per conv
  // at a time — so the per-conv cap need only fit one full round's worth of
  // members. Match groupMemberLimit so a max-sized group can fan out.
  concurrentAgentsPerConv: intEnv('JCHAT_CONCURRENT_AGENTS_PER_CONV', 20),
  concurrentAgentsPerUser: intEnv('JCHAT_CONCURRENT_AGENTS_PER_USER', 20),
  globalWorkerLimit: intEnv('JCHAT_GLOBAL_WORKER_LIMIT', 60),
  workerIdleMs: intEnv('JCHAT_WORKER_IDLE_MS', 600000),

  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  uploadMaxSize: intEnv('JCHAT_UPLOAD_MAX_SIZE', 50 * 1024 * 1024),
  memoryTopK: intEnv('JCHAT_MEMORY_TOP_K', 8),

  heartbeatIntervalMs: 15000,
  staleConnectionMs: 25000
};

// SUPABASE_URL + SUPABASE_ANON_KEY only required during AUTH_TRANSITION fallback
if (config.authTransition && (!config.supabaseUrl || !config.supabaseAnonKey)) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required when AUTH_TRANSITION=1');
}
if (!config.jwtAccessSecret) {
  throw new Error('LOCAL_JWT_ACCESS_SECRET is required for JWT signing/verification');
}
if (!config.jwtRefreshSecret) {
  throw new Error('LOCAL_JWT_REFRESH_SECRET is required for refresh token signing/verification');
}
if (!config.anthropicApiKey) {
  throw new Error('ANTHROPIC_API_KEY is required');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Set to postgresql://user:pass@127.0.0.1:5432/jobchat');
}
