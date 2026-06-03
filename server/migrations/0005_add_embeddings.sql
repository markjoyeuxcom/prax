create extension if not exists vector;

alter table markdown_documents
  add column if not exists embedding vector,
  add column if not exists embedding_backend text,
  add column if not exists embedding_model text,
  add column if not exists embedding_dim int,
  add column if not exists embedded_hash text,
  add column if not exists embedded_at timestamptz;
