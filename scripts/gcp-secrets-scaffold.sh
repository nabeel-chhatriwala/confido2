#!/usr/bin/env bash
set -euo pipefail

# Creates Secret Manager secret NAMES in the project.
# Values are entered manually by an operator via `gcloud secrets versions add`.

PROJECT=${PROJECT:-clinical-workflow-lakeway}

SECRETS=(
  supabase-db-url
  supabase-service-role-key
  supabase-anon-key
  supabase-jwt-secret
  twilio-account-sid
  twilio-auth-token
  twilio-signing-key
  internal-svc-token
  provider-key-openai
  provider-key-anthropic
  provider-key-groq
  provider-key-deepgram
  provider-key-assemblyai
  provider-key-elevenlabs
  provider-key-cartesia
)

for s in "${SECRETS[@]}"; do
  if gcloud secrets describe "$s" --project="$PROJECT" >/dev/null 2>&1; then
    echo "exists: $s"
  else
    gcloud secrets create "$s" \
      --replication-policy=automatic \
      --project="$PROJECT"
    echo "created: $s"
  fi
done

echo
echo "Operator must now run, once per secret:"
echo "  echo -n 'VALUE' | gcloud secrets versions add <secret> --data-file=- --project=$PROJECT"
