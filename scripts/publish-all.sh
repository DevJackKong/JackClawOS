#!/bin/bash
set -e

# Publish JackClaw packages in dependency order.
# Run from the repo root: bash scripts/publish-all.sh

echo "🦞 JackClaw publish-all — starting..."

cd packages/protocol && npm publish --access public && cd ../..
cd packages/tunnel && npm publish --access public && cd ../..
cd packages/memory && npm publish --access public && cd ../..
cd packages/llm-gateway && npm publish --access public && cd ../..
cd packages/hub && npm publish --access public && cd ../..
cd packages/node && npm publish --access public && cd ../..
cd packages/jackclaw-sdk && npm publish --access public && cd ../..
cd packages/cli && npm publish --access public && cd ../..
cd packages/create-jackclaw && npm publish --access public && cd ../..

echo "✅ All packages published successfully."
