#!/usr/bin/env bash
# bring-up-supabase-stack.sh — Start the local Supabase containers in the
# exact order Uthena needs. Idempotent: re-running is safe.
#
# Why this script exists
# ----------------------
# The default `supabase start` from the Supabase CLI provisions containers
# in the default order, but our setup requires two specific adjustments:
#
#   1. PostgREST must point at DB `postgres` (the Supabase default), NOT
#      a separately-named DB like `uthena`. If you ever split DBs (we did,
#      accidentally), PostgREST keeps pointing at `postgres` and you'll
#      get "relation does not exist" on every table.
#
#   2. The `authenticator` role needs GRANT on every public table — it
#      doesn't inherit from `anon` or `authenticated` automatically, and
#      without it PostgREST hides the table entirely. This is a known
#      PostgREST quirk; the standard Supabase migrations grant it on
#      tables Supabase itself owns, but user-created tables bypass that.
#
# How to use
# ----------
#     pnpm dev         # Next.js dev server (separate)
#     ./infra/bring-up-supabase-stack.sh   # this script
#
# After this: the API gateway is on http://127.0.0.1:54421 and the
# Next.js dev server (if running) can talk to it.

set -euo pipefail

NETWORK=supabase_network_Uthena
DB_CONTAINER=supabase_db_Uthena
REST_CONTAINER=supabase_rest_Uthena
KONG_CONTAINER=supabase_kong_Uthena
DB_PORT=54422
GATEWAY_PORT=54421
REST_HOST_PORT=54420  # PostgREST internal port (not exposed externally)

# JWT secret must match the value the auth container started with.
JWT_SECRET='{"keys":[{"kty":"oct","k":"c3VwZXItc2VjcmV0LWp3dC10b2tlbi13aXRoLWF0LWxlYXN0LTMyLWNoYXJhY3RlcnMtbG9uZw"}]}'

log() { printf '\033[1;34m[stack]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[stack]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[stack]\033[0m %s\n' "$*"; exit 1; }

# 1. Ensure the network exists.
log "ensuring network '$NETWORK' exists"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

# 2. Ensure the database container is running on the right port.
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  if docker ps -a --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
    log "starting stopped db container"
    docker start "$DB_CONTAINER" >/dev/null
  else
    die "Expected container '$DB_CONTAINER' to exist. Run \`supabase start\` first."
  fi
fi
# Attach to our network if not already
DB_NET=$(docker inspect "$DB_CONTAINER" -f '{{json .NetworkSettings.Networks}}' 2>/dev/null || echo '{}')
if ! echo "$DB_NET" | grep -q "$NETWORK"; then
  log "attaching db container to network"
  docker network connect "$NETWORK" "$DB_CONTAINER" 2>/dev/null || true
fi

# 3. Run migrations + seed against DB 'postgres' (not 'uthena').
log "running migrations"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres" pnpm --silent db:bootstrap >/dev/null
log "seeding fixture data"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres" pnpm --silent db:seed >/dev/null

# 4. Grant privileges to authenticator + anon + authenticated on every public table.
log "granting privileges to authenticator / anon / authenticated"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  t text;
  s text;
begin
  for t in select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' loop
    execute format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    execute format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon', t);
    execute format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticator', t);
  end loop;
  for s in select sequence_name from information_schema.sequences where sequence_schema='public' loop
    execute format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticator', s);
  end loop;
end $$;
SQL

# 5. Ensure the PostgREST container is up and connected.
if ! docker ps --format '{{.Names}}' | grep -q "^${REST_CONTAINER}$"; then
  log "starting PostgREST (port ${REST_HOST_PORT} → container:3000)"
  docker rm "$REST_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$REST_CONTAINER" \
    --network "$NETWORK" \
    -p "${REST_HOST_PORT}:3000" \
    -e PGRST_DB_URI="postgresql://authenticator:postgres@db:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public,graphql_public \
    -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
    -e PGRST_DB_ANON_ROLE=anon \
    -e PGRST_JWT_SECRET="$JWT_SECRET" \
    -e PGRST_DB_MAX_ROWS=1000 \
    -e PGRST_SERVER_PORT=3000 \
    public.ecr.aws/supabase/postgrest:v12.2.0 \
    >/dev/null
  sleep 4
fi

# 6. Ensure Kong is up.
if ! docker ps --format '{{.Names}}' | grep -q "^${KONG_CONTAINER}$"; then
  log "starting Kong (port ${GATEWAY_PORT} → container:8000)"
  # Extract config + certs from the running app Kong (supabase_kong_app) as a template.
  # This way we don't have to maintain our own kong.yml.
  if ! docker ps --format '{{.Names}}' | grep -q '^supabase_kong_app$'; then
    die "Cannot find template Kong container 'supabase_kong_app'. Start GrabLTD's stack first to bootstrap the template."
  fi
  docker cp supabase_kong_app:/home/kong/kong.yml /tmp/kong_Uthena.yml >/dev/null
  docker cp supabase_kong_app:/home/kong/localhost.crt /tmp/localhost.crt >/dev/null
  docker cp supabase_kong_app:/home/kong/localhost.key /tmp/localhost.key >/dev/null
  # Rewrite aliases to point at our auth_Uthena / rest_Uthena containers
  sed -i '' -e 's/supabase_auth_app/supabase_auth_Uthena/g' -e 's/supabase_rest_app/supabase_rest_Uthena/g' /tmp/kong_Uthena.yml 2>/dev/null || \
  sed -i -e 's/supabase_auth_app/supabase_auth_Uthena/g' -e 's/supabase_rest_app/supabase_rest_Uthena/g' /tmp/kong_Uthena.yml

  docker rm "$KONG_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$KONG_CONTAINER" \
    --network "$NETWORK" \
    -p "${GATEWAY_PORT}:8000" \
    -e KONG_DATABASE=off \
    -e KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml \
    -e KONG_DNS_ORDER=LAST,A,CNAME \
    -e KONG_PLUGINS=request-transformer,cors \
    -e KONG_PORT_MAPS="${GATEWAY_PORT}:8000" \
    -v /tmp/kong_Uthena.yml:/home/kong/kong.yml:ro \
    -v /tmp/localhost.crt:/home/kong/localhost.crt:ro \
    -v /tmp/localhost.key:/home/kong/localhost.key:ro \
    public.ecr.aws/supabase/kong:2.8.1 \
    >/dev/null
  sleep 6
fi

# 7. Smoke test.
log "smoke test"
TOKEN=$(curl -s -X POST "http://127.0.0.1:${GATEWAY_PORT}/auth/v1/token?grant_type=password" \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@uthena.com","password":"buyer@uthena.com"}' \
  | grep -oE '"access_token":"[^"]+' | cut -d'"' -f4 || true)
if [[ -z "$TOKEN" ]]; then
  warn "login failed — is the auth container healthy?"
  exit 1
fi
COUNT=$(curl -s "http://127.0.0.1:${GATEWAY_PORT}/rest/v1/progress?select=count" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY:-placeholder}" \
  -H "Authorization: Bearer $TOKEN")
log "progress for buyer: ${COUNT}"

log "done. App at http://localhost:3100  ·  API at http://127.0.0.1:${GATEWAY_PORT}"