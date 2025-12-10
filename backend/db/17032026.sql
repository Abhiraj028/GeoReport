create type client_type as enum ('admin', 'user', 'guest');

create table users (
    id bigserial primary key,
    type client_type default 'guest' not null,
    
    name varchar(255),
    email varchar(255) unique,
    phone varchar(20) unique,
    password_hash text,
    
    device_token text unique not null,
    user_trust integer default 3,
    
    created_at timestamptz default now(),
    last_seen_at timestamptz
);

create table reports (
    id bigserial primary key,
    user_id bigint references users(id) on delete set null,
    
    latitude double precision not null,
    longitude double precision not null,
    location geography(Point, 4326) generated always as (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) stored,

    text_content text,

    captured_at timestamptz,
    created_at timestamptz default now()
);

create index idx_reports_location on reports using gist(location));
create index idx_reports_effective_time on reports (coalesce(captured_at, created_at));

create type media_type as enum ('image', 'video', 'audio');

create table report_media (
    id bigserial primary key,
    report_id bigint references reports(id) on delete cascade,

    media_url text not null,
    media_type media_type not null,

    metadata jsonb,

    created_at timestamptz default now()
);
