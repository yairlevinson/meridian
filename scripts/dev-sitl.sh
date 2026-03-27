#!/usr/bin/env bash
#
# Start PX4 SITL in Docker, run the app connected to it, and clean up on exit.
#
# Usage:
#   ./scripts/dev-sitl.sh              # PX4 (default)
#   GC_SITL_IMAGE=other/image ./scripts/dev-sitl.sh
#
set -euo pipefail

CONTAINER_NAME="meridian-dev-sitl"
SITL_IMAGE="${GC_SITL_IMAGE:-meridian-px4-sitl:latest}"
SITL_PORT="${GC_SITL_PORT:-5760}"
HOME_LAT="${PX4_HOME_LAT:-42.3898}"
HOME_LON="${PX4_HOME_LON:--71.1476}"
HOME_ALT="${PX4_HOME_ALT:-14}"

cleanup() {
  echo ""
  echo "[dev-sitl] Stopping SITL container..."
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  echo "[dev-sitl] Done."
}

# Always clean up on exit, interrupt, or termination
trap cleanup EXIT INT TERM

# Remove leftover container from a previous run
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "[dev-sitl] Starting $SITL_IMAGE on port $SITL_PORT..."
docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -p "${SITL_PORT}:5760" \
  -e "PX4_HOME_LAT=$HOME_LAT" \
  -e "PX4_HOME_LON=$HOME_LON" \
  -e "PX4_HOME_ALT=$HOME_ALT" \
  "$SITL_IMAGE"

echo "[dev-sitl] Waiting for SITL to be ready (TCP port $SITL_PORT)..."
for i in $(seq 1 60); do
  if nc -z 127.0.0.1 "$SITL_PORT" 2>/dev/null; then
    echo "[dev-sitl] SITL ready after ${i}s"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[dev-sitl] ERROR: SITL not ready after 60s"
    exit 1
  fi
  sleep 1
done

echo "[dev-sitl] Starting app with GC_TCP_LINKS=127.0.0.1:$SITL_PORT"
GC_TCP_LINKS="127.0.0.1:$SITL_PORT" npx electron-vite dev
