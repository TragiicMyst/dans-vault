#!/usr/bin/env bash
set -u

BOT="${1:?bot type required}"
STATE_NAME="${2:?state file required}"
HEALTH_NAME="${3:?health file required}"
GIT_NAME="${4:?git author name required}"
CYCLES="${5:-3}"
INTERVAL_SECONDS="${6:-300}"
STATE_PATH="vinted-radar/${STATE_NAME}"
HEALTH_PATH="vinted-radar/${HEALTH_NAME}"
TMP_STATE="/tmp/${BOT}-cycle-state.json"
TMP_HEALTH="/tmp/${BOT}-cycle-health.json"

set -e
git config user.name "$GIT_NAME"
git config user.email "actions@users.noreply.github.com"

build_health() {
  node - "$TMP_STATE" "$TMP_HEALTH" <<'NODE'
const fs = require('fs');
const input = process.argv[2];
const output = process.argv[3];
const s = JSON.parse(fs.readFileSync(input, 'utf8'));
const d = s.diagnostics || {};
const health = {
  generatedAt: s.updatedAt ?? s.freshness?.lastAttemptAt ?? s.freshness?.lastScanAt ?? null,
  stateUpdatedAt: s.updatedAt ?? null,
  lastAttemptAt: s.freshness?.lastAttemptAt ?? null,
  lastScanAt: s.freshness?.lastScanAt ?? null,
  cooldownUntil: s.cooldownUntil ?? null,
  healthyScan: d.healthyScan ?? false,
  healthReason: d.healthReason ?? null,
  selectedSearches: d.selectedSearches ?? [],
  successfulSearches: d.successfulSearches ?? 0,
  failedSearches: d.failedSearches ?? 0,
  catalogMarkers: d.catalogMarkers ?? 0,
  catalogItems: d.catalogItems ?? 0,
  candidateItems: d.candidateItems ?? 0,
  freshItems: d.freshItems ?? 0,
  qualifyingAlerts: d.qualifyingAlerts ?? 0,
  qualifyingByCondition: d.qualifyingByCondition ?? {},
  deliveredAlerts: d.deliveredAlerts ?? 0,
  deliveredByCondition: d.deliveredByCondition ?? {},
  duplicateSuppressed: d.duplicateSuppressed ?? 0,
  discordFailures: d.discordFailures ?? 0,
  discordRoutes: d.discordRoutes ?? [],
  discordRouteAutoCorrected: d.discordRouteAutoCorrected ?? false,
  discordRouteWarnings: d.discordRouteWarnings ?? [],
  pendingDeliveries: d.pendingDeliveries ?? 0,
  detailFetches: d.detailFetches ?? 0,
  rejects: d.rejects ?? {},
  failures: d.failures ?? {}
};
fs.writeFileSync(output, JSON.stringify(health, null, 2) + '\n');
NODE
}

save_state() {
  node -e "const fs=require('fs'); const raw=fs.readFileSync('$STATE_PATH','utf8'); if(!raw.trim()) throw new Error('Refusing empty radar state'); JSON.parse(raw);"
  cp "$STATE_PATH" "$TMP_STATE"
  build_health

  for attempt in 1 2 3 4 5; do
    git fetch origin main
    git reset --hard origin/main

    if [ -f "$STATE_PATH" ]; then
      if node - "$TMP_STATE" "$STATE_PATH" <<'NODE'
const fs=require('fs');
const local=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const remote=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const lt=Date.parse(local.updatedAt||local.freshness?.lastAttemptAt||local.freshness?.lastScanAt||0);
const rt=Date.parse(remote.updatedAt||remote.freshness?.lastAttemptAt||remote.freshness?.lastScanAt||0);
process.exit(Number.isFinite(rt)&&Number.isFinite(lt)&&rt>lt?0:1);
NODE
      then
        echo "Remote $BOT state is newer; refusing stale overwrite."
        return 0
      fi
    fi

    cp "$TMP_STATE" "$STATE_PATH"
    cp "$TMP_HEALTH" "$HEALTH_PATH"
    git add "$STATE_PATH" "$HEALTH_PATH"
    if git diff --cached --quiet; then return 0; fi
    git commit -m "Update Nike ${BOT} radar state"
    if git push origin HEAD:main; then return 0; fi
    sleep 2
  done
  return 1
}

successful_cycles=0
for cycle in $(seq 1 "$CYCLES"); do
  cycle_start=$(date +%s)
  echo "=== $BOT cycle $cycle/$CYCLES ==="

  set +e
  timeout 115s node vinted-radar/run-bot.mjs
  rc=$?
  set -e

  # runRadarV6 persists useful partial diagnostics on normal unhealthy exits.
  # Save after every cycle so dedupe markers/frontiers survive even if that cycle failed.
  if [ -f "$STATE_PATH" ]; then
    save_state || echo "Warning: failed to save $BOT state for cycle $cycle"
  fi

  if [ "$rc" -eq 0 ]; then
    successful_cycles=$((successful_cycles + 1))
  elif [ "$rc" -eq 124 ]; then
    echo "$BOT cycle $cycle timed out after 115s; moving on without wedging the worker."
  else
    echo "$BOT cycle $cycle exited $rc; moving on to the next scheduled cycle."
  fi

  if [ "$cycle" -lt "$CYCLES" ]; then
    elapsed=$(( $(date +%s) - cycle_start ))
    sleep_for=$(( INTERVAL_SECONDS - elapsed ))
    if [ "$sleep_for" -gt 0 ]; then sleep "$sleep_for"; fi
  fi
done

if [ "$successful_cycles" -eq 0 ]; then
  echo "No healthy $BOT cycles completed in this worker."
  exit 1
fi

echo "$BOT worker completed with $successful_cycles/$CYCLES healthy cycles."
