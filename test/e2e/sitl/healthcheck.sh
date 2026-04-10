#!/bin/bash
# Docker healthcheck: verify PX4 is running.
# NOTE: Do NOT use "nc -z localhost 5760" — the TCP bridge only
# supports one client at a time, and healthcheck connections can
# disrupt the real MAVLink client.
pgrep -f "bin/px4" > /dev/null || exit 1
