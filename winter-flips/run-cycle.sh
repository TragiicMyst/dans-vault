#!/usr/bin/env bash
set -u

CYCLES="${1:-3}"
INTERVAL_SECONDS="${2:-180}"
CYCLE_TIMEOUT_SECONDS="${3:-105}"
STATE_PATH="winter-flips/state.json"
REPORT_PATH="winter-flips/latest-report.json"
INTEL_PATH="winter-flips/intelligence-state.json"
TMP_STATE="/tmp/winter-flips-state.json"
TMP_REPORT="/tmp/winter-flips-report.json"
TMP_INTEL="/tmp/winter-flips-intelligence-state.json"

set -e
git config user.name "Dan's Vault Winter Flips"
git config user.email "actions@users.noreply.github.com"

successful_cycles=0
for cycle in $(seq 1 "$CYCLES"); do
  cycle_start=$(date +%s)
  echo "=== Winter Flips cycle $cycle/$CYCLES ==="

  set +e
  timeout "${CYCLE_TIMEOUT_SECONDS}s" node winter-flips/run-conditioned.mjs
  rc=$?
  if [ "$rc" -eq 0 ]; then
    node winter-flips/intelligence.mjs
    intel_rc=$?
  else
    intel_rc=0
  fi
  set -e

  if [ "$rc" -eq 0 ]; then
    successful_cycles=$((successful_cycles + 1))
    if [ "$intel_rc" -ne 0 ]; then echo "Winter intelligence exited $intel_rc; core scan still completed."; fi
  elif [ "$rc" -eq 124 ]; then
    echo "Winter Flips cycle timed out after ${CYCLE_TIMEOUT_SECONDS}s."
  else
    echo "Winter Flips cycle exited $rc; continuing."
  fi

  if [ "$cycle" -lt "$CYCLES" ]; then
    elapsed=$(( $(date +%s) - cycle_start ))
    sleep_for=$(( INTERVAL_SECONDS - elapsed ))
    if [ "$sleep_for" -gt 0 ]; then sleep "$sleep_for"; fi
  fi
done

if [ -f "$STATE_PATH" ]; then cp "$STATE_PATH" "$TMP_STATE"; fi
if [ -f "$REPORT_PATH" ]; then cp "$REPORT_PATH" "$TMP_REPORT"; fi
if [ -f "$INTEL_PATH" ]; then cp "$INTEL_PATH" "$TMP_INTEL"; fi

save_state() {
  [ -f "$TMP_STATE" ] || return 0
  node -e "JSON.parse(require('fs').readFileSync('$TMP_STATE','utf8'))"
  if [ -f "$TMP_INTEL" ]; then node -e "JSON.parse(require('fs').readFileSync('$TMP_INTEL','utf8'))"; fi

  for attempt in 1 2 3 4 5; do
    git fetch origin main
    git reset --hard origin/main
    mkdir -p winter-flips
    cp "$TMP_STATE" "$STATE_PATH"
    if [ -f "$TMP_REPORT" ]; then cp "$TMP_REPORT" "$REPORT_PATH"; fi
    if [ -f "$TMP_INTEL" ]; then cp "$TMP_INTEL" "$INTEL_PATH"; fi
    git add "$STATE_PATH"
    if [ -f "$REPORT_PATH" ]; then git add "$REPORT_PATH"; fi
    if [ -f "$INTEL_PATH" ]; then git add "$INTEL_PATH"; fi
    if git diff --cached --quiet; then return 0; fi
    git commit -m "Update Winter Flips radar state"
    if git push origin HEAD:main; then return 0; fi
    sleep 2
  done
  return 1
}

save_state || echo "Warning: Winter Flips state could not be persisted."

if [ "$successful_cycles" -eq 0 ]; then
  echo "No Winter Flips cycles completed successfully."
  exit 1
fi

echo "Winter Flips worker completed with $successful_cycles/$CYCLES successful cycles."
