-- 004: chunk embeddings for vector retrieval (GAP-018).
--
-- Retrieval moves from lexical overlap to meaning: source_chunks carry an embedding, and
-- searchChunks ranks with the pgvector cosine operator (<=>) when a query embedding is
-- supplied, falling back to full-text ranking when it is not (deployments without an
-- embedding capability stay lexical).
--
-- The extension is installed in `public` explicitly: it can live in exactly one schema, and
-- the test pools confine their search_path to a per-suite schema, so `public` is the one place
-- every schema can see the vector type and the <=> operator.
--
-- Forward-only: shipped migrations are never edited; this adds to 001-003.

CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

ALTER TABLE source_chunks ADD COLUMN embedding public.vector(384);

CREATE INDEX IF NOT EXISTS source_chunks_embedding_idx
  ON source_chunks USING hnsw (embedding public.vector_cosine_ops);
