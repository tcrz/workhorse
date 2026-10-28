#!/bin/bash
set -e

# Standalone fallback. Scaffolded harnesses use `node init.mjs` (with init.sh as a wrapper).
# This harness runs static checks only — behaviour is verified by the Reviewer, not tests.

echo "=== Harness Initialization (static checks) ==="

run_script() {
  node -e "const s=require('./package.json').scripts||{}; process.exit(s['$1']?0:1)" && {
    if [ "$PM" = "npm" ]; then npm run "$1"; else "$PM" run "$1"; fi
  } || true
}

if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then PM="pnpm"
  elif [ -f yarn.lock ]; then PM="yarn"
  elif [ -f bun.lock ] || [ -f bun.lockb ]; then PM="bun"
  else PM="npm"; fi

  echo "=== Installing dependencies with $PM ==="
  "$PM" install
  run_script check
  run_script typecheck
  run_script lint
  [ "$1" = "--build" ] && run_script build
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  python -m compileall -q .
elif [ -f go.mod ]; then
  go vet ./...
  [ "$1" = "--build" ] && go build ./...
elif [ -f Cargo.toml ]; then
  cargo check
  [ "$1" = "--build" ] && cargo build --release
elif [ -f pom.xml ]; then
  mvn -q compile
  [ "$1" = "--build" ] && mvn -q package -DskipTests
elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then
  ./gradlew classes
  [ "$1" = "--build" ] && ./gradlew assemble
elif ls *.csproj *.sln >/dev/null 2>&1; then
  dotnet build
else
  echo "No recognized package manifest detected."
  echo "Replace this section with the project's static check and build commands."
fi

echo "=== Verification Complete ==="
