#!/usr/bin/env sh
set -eu

image="agrocylo-server-no-db-credentials:test"
marker="AGROCYLO_DATABASE_URL_MUST_NOT_REACH_IMAGE_946"

docker build \
  --build-arg "DATABASE_URL=postgresql://${marker}:${marker}@example.invalid:5432/${marker}" \
  --tag "$image" \
  server

metadata="$(docker image inspect "$image" --format '{{json .Config.Env}}')
$(docker history "$image" --no-trunc --format '{{.CreatedBy}}')"

if printf '%s' "$metadata" | grep -F "$marker" >/dev/null; then
  echo "Database URL marker leaked into the server image metadata" >&2
  exit 1
fi

echo "Verified: server image contains no build-time database URL marker"
