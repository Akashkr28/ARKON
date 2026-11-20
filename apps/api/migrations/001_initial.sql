-- Uploaded CAD models. A STEP upload goes queued → converting → ready | failed;
-- a GLB upload is ready as soon as it's stored.
create table models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  original_filename text not null,
  source_format text not null check (source_format in ('step', 'glb')),
  source_path text not null, -- relative to STORAGE_DIR
  source_bytes bigint not null,
  status text not null default 'queued'
    check (status in ('queued', 'converting', 'ready', 'failed')),
  error text,
  glb_path text, -- relative to STORAGE_DIR, set once ready
  glb_bytes bigint,
  part_count integer,
  triangle_count integer,
  bounds jsonb, -- { "min": [x, y, z], "max": [x, y, z], "units": "m" }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index models_created_at on models (created_at desc);

-- One row per mesh in the converted GLB, in the order the viewer sees them.
create table model_parts (
  model_id uuid not null references models (id) on delete cascade,
  part_index integer not null,
  name text not null,
  parent_name text,
  triangle_count integer not null default 0,
  color text, -- "#rrggbb" from the STEP file, if it had one
  primary key (model_id, part_index)
);

-- Work queue for the converter. Workers claim rows with FOR UPDATE SKIP LOCKED.
create table conversion_jobs (
  id bigserial primary key,
  model_id uuid not null references models (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  quality text not null default 'standard'
    check (quality in ('draft', 'standard', 'fine')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index conversion_jobs_queued on conversion_jobs (created_at) where status = 'queued';

create function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger models_touch_updated_at
  before update on models
  for each row execute function touch_updated_at();
