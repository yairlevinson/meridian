#!/usr/bin/env bash
#
# Run SITL E2E tests against PX4 + Gazebo.
#
# Usage:
#   PX4_HOME=/path/to/PX4-Autopilot ./scripts/run-sitl-tests.sh
#
# PX4_HOME    — path to your PX4-Autopilot source directory (required)
# PX4_SITL_TARGET — Gazebo model to use (default: gz_x500_depth)
#
# The script auto-launches PX4 SITL + Gazebo via the test infrastructure
# and tears it down when tests complete.

set -euo pipefail

if [ -z "${PX4_HOME:-}" ]; then
  echo "Error: PX4_HOME is not set."
  echo ""
  echo "Usage:"
  echo "  PX4_HOME=/path/to/PX4-Autopilot ./scripts/run-sitl-tests.sh"
  exit 1
fi

if [ ! -f "$PX4_HOME/Makefile" ]; then
  echo "Error: $PX4_HOME does not look like a PX4-Autopilot directory."
  echo "Expected to find $PX4_HOME/Makefile"
  exit 1
fi

echo "PX4 SITL directory: $PX4_HOME"
echo "Target: ${PX4_SITL_TARGET:-gz_x500_depth}"
echo ""
echo "Running SITL E2E tests..."
echo ""

export GC_E2E_SITL=1
export GC_E2E_SITL_EXTERNAL=1
export PX4_HOME

exec npx playwright test sitl-
