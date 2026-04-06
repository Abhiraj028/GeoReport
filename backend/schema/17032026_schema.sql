-- ============================================================
-- SlideTag — Database Schema
-- v2 — rebuilt 2026-08-16
-- ============================================================

-- clusters must be defined before reports (reports has a FK into clusters)
create table clusters (
    id                       bigserial primary key,

    centroid                 geography(Point, 4326) not null,
    max_spread               double precision not null,

    report_count             integer default 1 not null,
    confidence_score         double precision default 0.0 not null,
    last_confidence_update   timestamptz,

    last_updated_at          timestamptz,
    is_active                boolean default true not null,

    created_at               timestamptz default now() not null
);

create index idx_clusters_centroid on clusters using gist(centroid);

-- ============================================================

-- users: anonymous-only in V1.
-- identity anchor is device_token_hash (SHA-256 of the raw bearer token).
-- raw token lives only in the browser cookie and in memory during the request.
create table users (
    id                  bigserial primary key,
    device_token_hash   text unique not null,
    user_trust          double precision default 0.5 not null,

    created_at          timestamptz default now() not null,
    last_seen_at        timestamptz
);

-- ============================================================

create table reports (
    id              bigserial primary key,

    -- user_token references the hash column; nulled if the user row is deleted
    user_token      text references users(device_token_hash) on delete set null,

    latitude        double precision not null,
    longitude       double precision not null,
    -- PostGIS generated column — always derived from lat/lon
    location        geography(Point, 4326) generated always as (
                        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                    ) stored,

    cluster_id      bigint references clusters(id) on delete set null,

    text_content    text,

    -- captured_at: when the user observed/captured the incident (client-supplied, nullable)
    -- created_at:  when the server received and stored the report (authoritative receipt time)
    captured_at     timestamptz,
    created_at      timestamptz default now() not null
);

create index idx_reports_location on reports using gist(location);
create index idx_reports_effective_time on reports (coalesce(captured_at, created_at));

-- ============================================================

create type media_status as enum ('pending', 'uploaded');
create type media_type   as enum ('image', 'video', 'audio');

-- media is deferred in V1 but schema is present.
-- status tracks the three-step upload lifecycle (pending → uploaded).
create table report_media (
    id           bigserial primary key,
    report_id    bigint references reports(id) on delete cascade,

    status       media_status default 'pending' not null,

    media_url    text not null,
    media_type   media_type not null,

    metadata     jsonb,

    created_at   timestamptz default now() not null
);