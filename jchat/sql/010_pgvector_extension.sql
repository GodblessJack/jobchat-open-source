-- 010_pgvector_extension.sql
-- Enables pgvector for Agent memory RAG and pg_trgm for fuzzy search.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
