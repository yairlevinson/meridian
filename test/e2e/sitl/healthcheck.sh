#!/bin/bash
# Docker healthcheck: verify MAVProxy TCP port is accepting connections.
# The SitlManager waits for a MAVLink HEARTBEAT over this connection,
# but a basic TCP check is sufficient for Docker's health status.
nc -z localhost "${SITL_CONTAINER_PORT:-5760}" || exit 1
