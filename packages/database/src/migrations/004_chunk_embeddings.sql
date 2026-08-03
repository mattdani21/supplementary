-- 004: chunk embeddings for vector retrieval (GAP-018).
--
-- Retrieval moves from lexical overlap to meaning: source_chunks carry an embedding, and
-- searchChunks ranks with the pgvector cosine operator (<=>) when a query embedding is
-- supplied, falling back to full-text ranking when it is not (deployments without an
-- embedding capability stay lexical).
--
-- Forward-only: shipped migrations are never edited; this adds to 001-003.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE source_chunks ADD COLUMN embedding vector(384);

CREATE INDEX IF NOT EXISTS source_chunks_embedding_idx
  ON source_chunks USING hnsw (embedding vector_cosine_ops);
