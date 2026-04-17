# Plan F: IaC + CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage Cloud Run services, Cloud Tasks queues, Secret Manager secret names, IAM bindings, Cloud Monitoring alerts, and Artifact Registry via Terraform (GCS-backed state, per-environment root modules). Add GitLab CI/CD pipelines for lint/test on every MR, dev deploys on merge to `main`, and manual-approval prod deploys.

**Architecture:** One Terraform root per environment (`dev`, `prod`), sharing modules under `infra/terraform/modules/`. Cloud Run images pinned by digest in tfvars; GitLab CI builds images via Cloud Build, writes digests to a per-env `images.auto.tfvars`, runs `terraform apply`. GitLab authenticates to GCP via OIDC → Workload Identity Federation (keyless; no service-account JSON ever lands in CI variables).

**Tech Stack:** Terraform 1.9+, Google provider 5.x, Cloud Build, GitLab CI/CD (.gitlab-ci.yml), OIDC Workload Identity Federation, Supabase CLI.

---

## Pre-reqs (assumed already done or handled elsewhere)

- GitLab project exists at a known path (e.g. `confido-health/confido2`). The `GITLAB_PROJECT_PATH` value below is used verbatim in the OIDC attribute condition — **update it to your actual path before running the bootstrap script.**
- GitLab CI/CD variables are populated with:
  - `SUPABASE_ACCESS_TOKEN` (personal access token for `supabase db push`)
  - `SUPABASE_DEV_PROJECT_REF`, `SUPABASE_DEV_DB_PASSWORD`
  - `SUPABASE_PROD_DB_PASSWORD`
  - Mark all of them **Masked** and **Protected** (available only on protected branches).

---

## File Structure

```
infra/terraform/
├── modules/
│   ├── cloud-run-service/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── cloud-tasks-queue/
│   │   ├── main.tf
│   │   └── variables.tf
│   ├── secret-names/
│   │   ├── main.tf
│   │   └── variables.tf
│   └── monitoring-alerts/
│       ├── main.tf
│       └── variables.tf
├── envs/
│   ├── dev/
│   │   ├── backend.tf
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── terraform.tfvars
│   │   └── images.auto.tfvars     # written by CI
│   └── prod/
│       ├── backend.tf
│       ├── main.tf
│       ├── variables.tf
│       ├── terraform.tfvars
│       └── images.auto.tfvars
└── README.md

.gitlab-ci.yml
cloudbuild/
├── orchestrator.yaml
├── pipecat-worker.yaml
├── dispatcher-worker.yaml
├── admin-api.yaml
└── ui.yaml
scripts/
├── gcp-bootstrap.sh
└── e2e-smoke.sh
```

---

## Task 1: GCS state bucket + IAM + GitLab OIDC WIF

**Files:**
- Create: `scripts/gcp-bootstrap.sh`

- [ ] **Step 1.1: Bootstrap script**

Create `scripts/gcp-bootstrap.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PROJECT=${PROJECT:-clinical-workflow-lakeway}
REGION=${REGION:-us-central1}
# Update these two before running:
GITLAB_PROJECT_PATH=${GITLAB_PROJECT_PATH:-confido-health/confido2}
GITLAB_ISSUER=${GITLAB_ISSUER:-https://gitlab.com}

gcloud config set project "$PROJECT"

gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  monitoring.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT"

# Terraform state bucket.
BUCKET="tfstate-$PROJECT"
if ! gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --project="$PROJECT" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://$BUCKET" --versioning
fi

# Artifact Registry.
if ! gcloud artifacts repositories describe voice --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create voice \
    --repository-format=docker --location="$REGION" --project="$PROJECT"
fi

# Runtime SA used by all Cloud Run services.
SA_NAME="voice-runtime"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT"
fi

# Workload Identity Pool + GitLab OIDC provider.
POOL="gitlab-ci"
PROVIDER="gitlab"
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT" \
    --display-name="GitLab CI"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
     --workload-identity-pool="$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global --project="$PROJECT" \
    --issuer-uri="$GITLAB_ISSUER" \
    --attribute-mapping="google.subject=assertion.sub,attribute.project_path=assertion.project_path,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type,attribute.environment=assertion.environment" \
    --attribute-condition="attribute.project_path=='$GITLAB_PROJECT_PATH'"
fi

# Deployer SA impersonated by GitLab CI jobs.
DEPLOY_SA="voice-deployer"
DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$DEPLOY_SA_EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$DEPLOY_SA" --project="$PROJECT"
fi

for ROLE in roles/run.admin roles/cloudtasks.admin roles/secretmanager.admin \
            roles/artifactregistry.writer roles/iam.serviceAccountUser \
            roles/storage.admin roles/cloudbuild.builds.editor roles/monitoring.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$DEPLOY_SA_EMAIL" --role="$ROLE" >/dev/null
done

# Allow runtime SA to be "actAs"ed by the deployer (needed to deploy Cloud Run services
# that run as runtime SA).
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PROJECT" \
  --role="roles/iam.serviceAccountUser" \
  --member="serviceAccount:$DEPLOY_SA_EMAIL" >/dev/null

# Bind the GitLab project to impersonate the deployer SA.
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" --project="$PROJECT" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.project_path/$GITLAB_PROJECT_PATH"

cat <<EOF

Bootstrap complete.
State bucket:           gs://$BUCKET
Runtime SA:             $SA_EMAIL
Deployer SA:            $DEPLOY_SA_EMAIL
WIF audience (for CI):  //iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER
Project number:         $PROJECT_NUMBER

Set these as (non-masked) GitLab CI/CD variables:
  GCP_PROJECT=$PROJECT
  GCP_PROJECT_NUMBER=$PROJECT_NUMBER
  GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER
  GCP_DEPLOYER_SA=$DEPLOY_SA_EMAIL
EOF
```

Make executable: `chmod +x scripts/gcp-bootstrap.sh`.

- [ ] **Step 1.2: Run bootstrap**

Run: `GITLAB_PROJECT_PATH=<group/subgroup/repo> PROJECT=clinical-workflow-lakeway bash scripts/gcp-bootstrap.sh`
Expected: prints the summary block at the end. Copy the five variable names/values into GitLab project settings → **Settings → CI/CD → Variables** (unmasked; mark `Protected` only if your `main` branch is protected, which it should be).

- [ ] **Step 1.3: Commit**

```bash
git add scripts/gcp-bootstrap.sh
git commit -m "chore(gcp): bootstrap script for state bucket + IAM + GitLab OIDC WIF"
```

---

## Task 2: Terraform module — cloud-run-service

**Files:**
- Create: `infra/terraform/modules/cloud-run-service/main.tf`
- Create: `infra/terraform/modules/cloud-run-service/variables.tf`
- Create: `infra/terraform/modules/cloud-run-service/outputs.tf`

- [ ] **Step 2.1: variables.tf**

Create `infra/terraform/modules/cloud-run-service/variables.tf`:

```hcl
variable "name"             { type = string }
variable "project"          { type = string }
variable "region"           { type = string }
variable "image"            { type = string }
variable "service_account"  { type = string }
variable "min_instances"    { type = number, default = 0 }
variable "max_instances"    { type = number, default = 100 }
variable "cpu"              { type = string, default = "1" }
variable "memory"           { type = string, default = "512Mi" }
variable "timeout_seconds"  { type = number, default = 300 }
variable "concurrency"      { type = number, default = 80 }
variable "env_plain"        { type = map(string), default = {} }
variable "env_secrets"      {
  description = "Map of ENV_NAME => secret short name (Secret Manager)"
  type        = map(string)
  default     = {}
}
variable "allow_unauthenticated" { type = bool, default = false }
```

- [ ] **Step 2.2: main.tf**

Create `infra/terraform/modules/cloud-run-service/main.tf`:

```hcl
resource "google_cloud_run_v2_service" "this" {
  name     = var.name
  project  = var.project
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = var.service_account
    timeout         = "${var.timeout_seconds}s"
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
    max_instance_request_concurrency = var.concurrency

    containers {
      image = var.image
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }
      dynamic "env" {
        for_each = var.env_plain
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.env_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

- [ ] **Step 2.3: outputs.tf**

Create `infra/terraform/modules/cloud-run-service/outputs.tf`:

```hcl
output "uri"  { value = google_cloud_run_v2_service.this.uri }
output "name" { value = google_cloud_run_v2_service.this.name }
```

- [ ] **Step 2.4: Commit**

```bash
git add infra/terraform/modules/cloud-run-service
git commit -m "feat(tf): add cloud-run-service module"
```

---

## Task 3: Terraform modules — cloud-tasks, secrets, monitoring

**Files:**
- Create: `infra/terraform/modules/cloud-tasks-queue/main.tf`
- Create: `infra/terraform/modules/cloud-tasks-queue/variables.tf`
- Create: `infra/terraform/modules/secret-names/main.tf`
- Create: `infra/terraform/modules/secret-names/variables.tf`
- Create: `infra/terraform/modules/monitoring-alerts/main.tf`
- Create: `infra/terraform/modules/monitoring-alerts/variables.tf`

- [ ] **Step 3.1: cloud-tasks-queue**

Create `infra/terraform/modules/cloud-tasks-queue/variables.tf`:

```hcl
variable "name"                     { type = string }
variable "project"                  { type = string }
variable "region"                   { type = string }
variable "max_dispatches_per_second" { type = number, default = 5 }
variable "max_concurrent_dispatches" { type = number, default = 500 }
variable "max_retry_duration_seconds" { type = number, default = 600 }
variable "max_attempts"             { type = number, default = 5 }
variable "min_backoff_seconds"      { type = number, default = 2 }
variable "max_backoff_seconds"      { type = number, default = 60 }
```

Create `infra/terraform/modules/cloud-tasks-queue/main.tf`:

```hcl
resource "google_cloud_tasks_queue" "this" {
  name     = var.name
  project  = var.project
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }
  retry_config {
    max_attempts       = var.max_attempts
    max_retry_duration = "${var.max_retry_duration_seconds}s"
    min_backoff        = "${var.min_backoff_seconds}s"
    max_backoff        = "${var.max_backoff_seconds}s"
    max_doublings      = 5
  }
}

output "name" { value = google_cloud_tasks_queue.this.name }
```

- [ ] **Step 3.2: secret-names**

Create `infra/terraform/modules/secret-names/variables.tf`:

```hcl
variable "project" { type = string }
variable "names"   { type = list(string) }
variable "accessor_member" {
  description = "The service account that may access these secrets (format: serviceAccount:<email>)."
  type        = string
}
```

Create `infra/terraform/modules/secret-names/main.tf`:

```hcl
resource "google_secret_manager_secret" "s" {
  for_each  = toset(var.names)
  project   = var.project
  secret_id = each.value

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each  = google_secret_manager_secret.s
  project   = var.project
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = var.accessor_member
}
```

- [ ] **Step 3.3: monitoring-alerts**

Create `infra/terraform/modules/monitoring-alerts/variables.tf`:

```hcl
variable "project"              { type = string }
variable "notification_channel" { type = string, default = "" }
```

Create `infra/terraform/modules/monitoring-alerts/main.tf`:

```hcl
locals {
  channels = var.notification_channel == "" ? [] : [var.notification_channel]
}

resource "google_monitoring_alert_policy" "dlq_nonempty" {
  project      = var.project
  display_name = "voice: Cloud Tasks dead-letter non-empty"
  combiner     = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "dlq depth"
    condition_threshold {
      filter          = "resource.type=\"cloud_tasks_queue\" AND resource.labels.queue_id=\"outbound-dlq\" AND metric.type=\"cloudtasks.googleapis.com/queue/depth\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "pool_exhausted" {
  project      = var.project
  display_name = "voice: Supabase pooler exhausted logs"
  combiner     = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "pool exhausted log spike"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND textPayload:\"pool exhausted\""
    }
  }
  alert_strategy {
    notification_rate_limit { period = "300s" }
  }
}
```

- [ ] **Step 3.4: Commit**

```bash
git add infra/terraform/modules/cloud-tasks-queue infra/terraform/modules/secret-names infra/terraform/modules/monitoring-alerts
git commit -m "feat(tf): add cloud-tasks, secret-names, monitoring modules"
```

---

## Task 4: Terraform env — dev

**Files:**
- Create: `infra/terraform/envs/dev/backend.tf`
- Create: `infra/terraform/envs/dev/variables.tf`
- Create: `infra/terraform/envs/dev/main.tf`
- Create: `infra/terraform/envs/dev/terraform.tfvars`
- Create: `infra/terraform/envs/dev/images.auto.tfvars`

- [ ] **Step 4.1: backend.tf**

Create `infra/terraform/envs/dev/backend.tf`:

```hcl
terraform {
  required_version = ">= 1.9"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
  backend "gcs" {
    bucket = "tfstate-clinical-workflow-lakeway"
    prefix = "dev"
  }
}

provider "google" {
  project = var.project
  region  = var.region
}
```

- [ ] **Step 4.2: variables.tf**

Create `infra/terraform/envs/dev/variables.tf`:

```hcl
variable "project"              { type = string }
variable "region"               { type = string, default = "us-central1" }
variable "runtime_sa_email"     { type = string }

variable "orchestrator_image"   { type = string }
variable "pipecat_image"        { type = string }
variable "dispatcher_image"     { type = string }
variable "admin_api_image"      { type = string }
variable "ui_image"             { type = string }

variable "supabase_project_ref" { type = string }
```

- [ ] **Step 4.3: main.tf**

Create `infra/terraform/envs/dev/main.tf`:

```hcl
locals {
  secret_names = [
    "supabase-db-url",
    "supabase-service-role-key",
    "supabase-anon-key",
    "supabase-jwt-secret",
    "twilio-account-sid",
    "twilio-auth-token",
    "twilio-signing-key",
    "internal-svc-token",
    "provider-key-openai",
    "provider-key-anthropic",
    "provider-key-groq",
    "provider-key-deepgram",
    "provider-key-assemblyai",
    "provider-key-elevenlabs",
    "provider-key-cartesia",
  ]
  runtime_sa_member = "serviceAccount:${var.runtime_sa_email}"
  supabase_url      = "https://${var.supabase_project_ref}.supabase.co"
}

module "secrets" {
  source          = "../../modules/secret-names"
  project         = var.project
  names           = local.secret_names
  accessor_member = local.runtime_sa_member
}

module "q_outbound" {
  source  = "../../modules/cloud-tasks-queue"
  project = var.project
  region  = var.region
  name    = "outbound-dispatch"
  max_dispatches_per_second = 5
}

module "q_outbound_dlq" {
  source  = "../../modules/cloud-tasks-queue"
  project = var.project
  region  = var.region
  name    = "outbound-dlq"
  max_attempts = 1
}

module "q_recording_pull" {
  source  = "../../modules/cloud-tasks-queue"
  project = var.project
  region  = var.region
  name    = "recording-pull"
}

module "orchestrator" {
  source           = "../../modules/cloud-run-service"
  project          = var.project
  region           = var.region
  name             = "call-orchestrator"
  image            = var.orchestrator_image
  service_account  = var.runtime_sa_email
  min_instances    = 0
  max_instances    = 20
  allow_unauthenticated = true
  env_plain = {
    PORT                         = "8080"
    SUPABASE_URL                 = local.supabase_url
    GCP_PROJECT                  = var.project
    GCP_TASK_LOCATION            = var.region
    RECORDING_PULL_QUEUE         = module.q_recording_pull.name
    PUBLIC_URL                   = "https://call-orchestrator-${var.project}.a.run.app"
    WORKER_WS_URL                = "wss://pipecat-worker-${var.project}.a.run.app/ws"
    RECORDING_PULL_HANDLER_URL   = "https://call-orchestrator-${var.project}.a.run.app/tasks/pull-recording"
  }
  env_secrets = {
    SUPABASE_SERVICE_ROLE_KEY = "supabase-service-role-key"
    TWILIO_AUTH_TOKEN         = "twilio-auth-token"
    TWILIO_SIGNING_KEY        = "twilio-signing-key"
    INTERNAL_SVC_TOKEN        = "internal-svc-token"
  }
}

module "pipecat" {
  source           = "../../modules/cloud-run-service"
  project          = var.project
  region           = var.region
  name             = "pipecat-worker"
  image            = var.pipecat_image
  service_account  = var.runtime_sa_email
  min_instances    = 2
  max_instances    = 200
  allow_unauthenticated = true
  cpu              = "2"
  memory           = "2Gi"
  timeout_seconds  = 3600
  concurrency      = 1
  env_plain = {
    PORT         = "8080"
    SUPABASE_URL = local.supabase_url
  }
  env_secrets = {
    SUPABASE_SERVICE_ROLE_KEY = "supabase-service-role-key"
    INTERNAL_SVC_TOKEN        = "internal-svc-token"
    PROVIDER_KEY_DEEPGRAM     = "provider-key-deepgram"
    PROVIDER_KEY_ASSEMBLYAI   = "provider-key-assemblyai"
    PROVIDER_KEY_OPENAI       = "provider-key-openai"
    PROVIDER_KEY_ANTHROPIC    = "provider-key-anthropic"
    PROVIDER_KEY_GROQ         = "provider-key-groq"
    PROVIDER_KEY_ELEVENLABS   = "provider-key-elevenlabs"
    PROVIDER_KEY_CARTESIA     = "provider-key-cartesia"
  }
}

module "dispatcher" {
  source           = "../../modules/cloud-run-service"
  project          = var.project
  region           = var.region
  name             = "dispatcher-worker"
  image            = var.dispatcher_image
  service_account  = var.runtime_sa_email
  env_plain = {
    PORT                                 = "8080"
    SUPABASE_URL                         = local.supabase_url
    ORCHESTRATOR_VOICE_OUTBOUND_URL      = "${module.orchestrator.uri}/voice/outbound"
    ORCHESTRATOR_VOICE_STATUS_URL        = "${module.orchestrator.uri}/voice/status"
  }
  env_secrets = {
    SUPABASE_SERVICE_ROLE_KEY = "supabase-service-role-key"
    TWILIO_ACCOUNT_SID        = "twilio-account-sid"
    TWILIO_AUTH_TOKEN         = "twilio-auth-token"
    INTERNAL_SVC_TOKEN        = "internal-svc-token"
  }
}

module "admin_api" {
  source           = "../../modules/cloud-run-service"
  project          = var.project
  region           = var.region
  name             = "admin-api"
  image            = var.admin_api_image
  service_account  = var.runtime_sa_email
  allow_unauthenticated = true
  env_plain = {
    PORT              = "8080"
    SUPABASE_URL      = local.supabase_url
    GCP_PROJECT       = var.project
    GCP_TASK_LOCATION = var.region
    OUTBOUND_QUEUE    = module.q_outbound.name
    DISPATCHER_URL    = "${module.dispatcher.uri}/tasks/place-call"
  }
  env_secrets = {
    SUPABASE_SERVICE_ROLE_KEY = "supabase-service-role-key"
    SUPABASE_ANON_KEY         = "supabase-anon-key"
    SUPABASE_JWT_SECRET       = "supabase-jwt-secret"
    INTERNAL_SVC_TOKEN        = "internal-svc-token"
  }
}

module "ui" {
  source           = "../../modules/cloud-run-service"
  project          = var.project
  region           = var.region
  name             = "voice-ui"
  image            = var.ui_image
  service_account  = var.runtime_sa_email
  allow_unauthenticated = true
  env_plain = {
    PORT                          = "8080"
    NEXT_PUBLIC_SUPABASE_URL      = local.supabase_url
    ADMIN_API_URL                 = module.admin_api.uri
  }
  env_secrets = {
    NEXT_PUBLIC_SUPABASE_ANON_KEY = "supabase-anon-key"
  }
}

module "alerts" {
  source  = "../../modules/monitoring-alerts"
  project = var.project
}
```

- [ ] **Step 4.4: tfvars**

Create `infra/terraform/envs/dev/terraform.tfvars`:

```hcl
project              = "clinical-workflow-lakeway"
region               = "us-central1"
runtime_sa_email     = "voice-runtime@clinical-workflow-lakeway.iam.gserviceaccount.com"
supabase_project_ref = "REPLACE_WITH_DEV_SUPABASE_PROJECT_REF"
```

Create `infra/terraform/envs/dev/images.auto.tfvars`:

```hcl
# Written by CI. Bootstrap placeholders (replace-then-apply manually first time if you're
# initializing the env locally).
orchestrator_image = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/call-orchestrator@sha256:REPLACE"
pipecat_image      = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/pipecat-worker@sha256:REPLACE"
dispatcher_image   = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/dispatcher-worker@sha256:REPLACE"
admin_api_image    = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/admin-api@sha256:REPLACE"
ui_image           = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/voice-ui@sha256:REPLACE"
```

- [ ] **Step 4.5: Init + validate**

Run: `(cd infra/terraform/envs/dev && terraform init -backend=false && terraform validate)`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4.6: Commit**

```bash
git add infra/terraform/envs/dev
git commit -m "feat(tf): add dev env with all services, queues, secrets, alerts"
```

---

## Task 5: Terraform env — prod

**Files:**
- Create: `infra/terraform/envs/prod/backend.tf`
- Create: `infra/terraform/envs/prod/variables.tf`
- Create: `infra/terraform/envs/prod/main.tf`
- Create: `infra/terraform/envs/prod/terraform.tfvars`
- Create: `infra/terraform/envs/prod/images.auto.tfvars`

- [ ] **Step 5.1: backend.tf**

Create `infra/terraform/envs/prod/backend.tf`:

```hcl
terraform {
  required_version = ">= 1.9"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
  backend "gcs" {
    bucket = "tfstate-clinical-workflow-lakeway"
    prefix = "prod"
  }
}
provider "google" {
  project = var.project
  region  = var.region
}
```

- [ ] **Step 5.2: variables.tf**

Create `infra/terraform/envs/prod/variables.tf`:

```hcl
variable "project"              { type = string }
variable "region"               { type = string, default = "us-central1" }
variable "runtime_sa_email"     { type = string }

variable "orchestrator_image"   { type = string }
variable "pipecat_image"        { type = string }
variable "dispatcher_image"     { type = string }
variable "admin_api_image"      { type = string }
variable "ui_image"             { type = string }

variable "supabase_project_ref" { type = string }
```

- [ ] **Step 5.3: main.tf — identical to dev/main.tf**

Copy the entire contents of `infra/terraform/envs/dev/main.tf` verbatim to `infra/terraform/envs/prod/main.tf`. It consumes only variables; no modifications needed.

- [ ] **Step 5.4: tfvars**

Create `infra/terraform/envs/prod/terraform.tfvars`:

```hcl
project              = "clinical-workflow-lakeway"
region               = "us-central1"
runtime_sa_email     = "voice-runtime@clinical-workflow-lakeway.iam.gserviceaccount.com"
supabase_project_ref = "ktfhsoajopeapqprmioj"
```

Create `infra/terraform/envs/prod/images.auto.tfvars`:

```hcl
orchestrator_image = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/call-orchestrator@sha256:REPLACE"
pipecat_image      = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/pipecat-worker@sha256:REPLACE"
dispatcher_image   = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/dispatcher-worker@sha256:REPLACE"
admin_api_image    = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/admin-api@sha256:REPLACE"
ui_image           = "us-central1-docker.pkg.dev/clinical-workflow-lakeway/voice/voice-ui@sha256:REPLACE"
```

- [ ] **Step 5.5: Init + validate**

Run: `(cd infra/terraform/envs/prod && terraform init -backend=false && terraform validate)`
Expected: valid.

- [ ] **Step 5.6: Commit**

```bash
git add infra/terraform/envs/prod
git commit -m "feat(tf): add prod env"
```

---

## Task 6: Cloud Build configs (one per image)

**Files:**
- Create: `cloudbuild/orchestrator.yaml`
- Create: `cloudbuild/pipecat-worker.yaml`
- Create: `cloudbuild/dispatcher-worker.yaml`
- Create: `cloudbuild/admin-api.yaml`
- Create: `cloudbuild/ui.yaml`

- [ ] **Step 6.1: orchestrator**

Create `cloudbuild/orchestrator.yaml`:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - buildx
      - build
      - --file=services/call-orchestrator/Dockerfile
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/voice/call-orchestrator:$COMMIT_SHA
      - --push
      - .
images:
  - us-central1-docker.pkg.dev/$PROJECT_ID/voice/call-orchestrator:$COMMIT_SHA
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
```

- [ ] **Step 6.2: pipecat-worker**

Create `cloudbuild/pipecat-worker.yaml`:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - buildx
      - build
      - --file=services/pipecat-worker/Dockerfile
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/voice/pipecat-worker:$COMMIT_SHA
      - --push
      - .
images:
  - us-central1-docker.pkg.dev/$PROJECT_ID/voice/pipecat-worker:$COMMIT_SHA
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
```

- [ ] **Step 6.3: dispatcher-worker**

Create `cloudbuild/dispatcher-worker.yaml`:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - buildx
      - build
      - --file=services/dispatcher-worker/Dockerfile
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/voice/dispatcher-worker:$COMMIT_SHA
      - --push
      - .
images:
  - us-central1-docker.pkg.dev/$PROJECT_ID/voice/dispatcher-worker:$COMMIT_SHA
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
```

- [ ] **Step 6.4: admin-api**

Create `cloudbuild/admin-api.yaml`:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - buildx
      - build
      - --file=services/admin-api/Dockerfile
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/voice/admin-api:$COMMIT_SHA
      - --push
      - .
images:
  - us-central1-docker.pkg.dev/$PROJECT_ID/voice/admin-api:$COMMIT_SHA
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
```

- [ ] **Step 6.5: ui**

Create `cloudbuild/ui.yaml`:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - buildx
      - build
      - --file=services/ui/Dockerfile
      - --tag=us-central1-docker.pkg.dev/$PROJECT_ID/voice/voice-ui:$COMMIT_SHA
      - --push
      - .
images:
  - us-central1-docker.pkg.dev/$PROJECT_ID/voice/voice-ui:$COMMIT_SHA
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
```

- [ ] **Step 6.6: Commit**

```bash
git add cloudbuild/
git commit -m "chore(cloudbuild): add per-service build configs"
```

---

## Task 7: E2E smoke placeholder

**Files:**
- Create: `scripts/e2e-smoke.sh`

- [ ] **Step 7.1: Stub**

Create `scripts/e2e-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ENV=${1:-dev}
echo "Running E2E smoke against $ENV"
# Placeholder — Plan G replaces this with a real synthetic call assertion.
exit 0
```

Make executable: `chmod +x scripts/e2e-smoke.sh`.

- [ ] **Step 7.2: Commit**

```bash
git add scripts/e2e-smoke.sh
git commit -m "chore(ci): add e2e smoke placeholder"
```

---

## Task 8: GitLab CI — .gitlab-ci.yml

**Files:**
- Create: `.gitlab-ci.yml`

- [ ] **Step 8.1: Pipeline file**

Create `.gitlab-ci.yml`:

```yaml
# GitLab CI/CD pipeline for confido2.
#
# Required GitLab CI/CD variables (Settings → CI/CD → Variables):
#   GCP_PROJECT               e.g. clinical-workflow-lakeway        (protected)
#   GCP_PROJECT_NUMBER        numeric project number                (protected)
#   GCP_WIF_PROVIDER          projects/<num>/.../providers/gitlab   (protected)
#   GCP_DEPLOYER_SA           voice-deployer@...gserviceaccount.com (protected)
#   SUPABASE_ACCESS_TOKEN     personal access token                 (masked, protected)
#   SUPABASE_DEV_PROJECT_REF                                        (protected)
#   SUPABASE_DEV_DB_PASSWORD                                        (masked, protected)
#   SUPABASE_PROD_DB_PASSWORD                                        (masked, protected)
#
# The job `deploy:dev` only runs on the protected `main` branch; `deploy:prod` is
# manual. This guarantees the OIDC identity token is only issued for protected
# contexts, matching the WIF attribute conditions set up by scripts/gcp-bootstrap.sh.

stages:
  - test
  - build
  - deploy-dev
  - deploy-prod

default:
  interruptible: true

# -------- Common job templates --------

.node-base:
  image: node:20-alpine
  cache:
    key:
      files: [package-lock.json]
    paths: [node_modules/, .turbo/]

.gcp-auth:
  # Jobs extending this get:
  #   - an OIDC id_token under $GCP_OIDC_TOKEN
  #   - gcloud configured with Workload Identity Federation, impersonating the deployer SA
  image: google/cloud-sdk:slim
  id_tokens:
    GCP_OIDC_TOKEN:
      aud: https://iam.googleapis.com/${GCP_WIF_PROVIDER}
  before_script:
    - echo "$GCP_OIDC_TOKEN" > /tmp/oidc_token
    - |
      gcloud iam workload-identity-pools create-cred-config \
        "${GCP_WIF_PROVIDER}" \
        --service-account="${GCP_DEPLOYER_SA}" \
        --output-file=/tmp/wif.json \
        --credential-source-file=/tmp/oidc_token \
        --credential-source-type=text
    - export GOOGLE_APPLICATION_CREDENTIALS=/tmp/wif.json
    - gcloud auth login --brief --cred-file=/tmp/wif.json
    - gcloud config set project "$GCP_PROJECT"

# -------- test stage --------

lint_typecheck_test:node:
  extends: .node-base
  stage: test
  script:
    - npm ci
    - npm run lint
    - npm run typecheck
    - npm run test

lint_test:python:
  stage: test
  image: python:3.12-slim
  before_script:
    - pip install uv
  script:
    - cd services/pipecat-worker
    - uv venv
    - uv pip install -e '.[dev]'
    - .venv/bin/ruff check src tests
    - .venv/bin/pytest

validate:terraform:
  stage: test
  image: hashicorp/terraform:1.9.8
  script:
    - terraform -chdir=infra/terraform/envs/dev init -backend=false
    - terraform -chdir=infra/terraform/envs/dev validate
    - terraform -chdir=infra/terraform/envs/prod init -backend=false
    - terraform -chdir=infra/terraform/envs/prod validate

supabase:lint:
  stage: test
  image: supabase/cli:latest
  script:
    - supabase db lint

# -------- build stage (only on main) --------

build:images:
  extends: .gcp-auth
  stage: build
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
  script:
    - |
      set -e
      declare -A CFG_TO_IMG=(
        [orchestrator]=call-orchestrator
        [pipecat-worker]=pipecat-worker
        [dispatcher-worker]=dispatcher-worker
        [admin-api]=admin-api
        [ui]=voice-ui
      )
      for svc in "${!CFG_TO_IMG[@]}"; do
        img="${CFG_TO_IMG[$svc]}"
        gcloud builds submit --config="cloudbuild/${svc}.yaml" \
          --substitutions="COMMIT_SHA=${CI_COMMIT_SHA}" \
          --project="$GCP_PROJECT"
        digest=$(gcloud artifacts docker images describe \
          "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/${img}:${CI_COMMIT_SHA}" \
          --format='value(image_summary.digest)')
        echo "${img}=${digest}" >> build_digests.env
      done
  artifacts:
    reports:
      dotenv: build_digests.env
    expire_in: 30 days

# -------- deploy-dev stage --------

deploy:dev:
  extends: .gcp-auth
  stage: deploy-dev
  needs: [build:images]
  environment:
    name: dev
    url: https://voice-ui-${GCP_PROJECT}.a.run.app
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
  script:
    - apt-get update && apt-get install -y curl unzip gnupg
    - curl -fsSLo supabase.deb https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb
    - dpkg -i supabase.deb
    - curl -fsSLo terraform.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip
    - unzip -o terraform.zip -d /usr/local/bin
    - supabase link --project-ref "$SUPABASE_DEV_PROJECT_REF"
    - SUPABASE_DB_PASSWORD="$SUPABASE_DEV_DB_PASSWORD" supabase db push
    - TF_DIR=infra/terraform/envs/dev
    - |
      cat > "$TF_DIR/images.auto.tfvars" <<EOF
      orchestrator_image = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/call-orchestrator@${call-orchestrator}"
      pipecat_image      = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/pipecat-worker@${pipecat-worker}"
      dispatcher_image   = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/dispatcher-worker@${dispatcher-worker}"
      admin_api_image    = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/admin-api@${admin-api}"
      ui_image           = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/voice-ui@${voice-ui}"
      EOF
    - terraform -chdir="$TF_DIR" init
    - terraform -chdir="$TF_DIR" apply -auto-approve
    - bash scripts/e2e-smoke.sh dev

# -------- deploy-prod stage (manual) --------

deploy:prod:
  extends: .gcp-auth
  stage: deploy-prod
  needs: [deploy:dev]
  environment:
    name: prod
    url: https://voice-ui-${GCP_PROJECT}.a.run.app
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual
  allow_failure: false
  script:
    - apt-get update && apt-get install -y curl unzip gnupg
    - curl -fsSLo supabase.deb https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb
    - dpkg -i supabase.deb
    - curl -fsSLo terraform.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip
    - unzip -o terraform.zip -d /usr/local/bin
    - supabase link --project-ref ktfhsoajopeapqprmioj
    - SUPABASE_DB_PASSWORD="$SUPABASE_PROD_DB_PASSWORD" supabase db push
    - TF_DIR=infra/terraform/envs/prod
    - |
      cat > "$TF_DIR/images.auto.tfvars" <<EOF
      orchestrator_image = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/call-orchestrator@${call-orchestrator}"
      pipecat_image      = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/pipecat-worker@${pipecat-worker}"
      dispatcher_image   = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/dispatcher-worker@${dispatcher-worker}"
      admin_api_image    = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/admin-api@${admin-api}"
      ui_image           = "us-central1-docker.pkg.dev/$GCP_PROJECT/voice/voice-ui@${voice-ui}"
      EOF
    - terraform -chdir="$TF_DIR" init
    - terraform -chdir="$TF_DIR" plan
    - terraform -chdir="$TF_DIR" apply -auto-approve
    - bash scripts/e2e-smoke.sh prod
```

- [ ] **Step 8.2: Local lint of the pipeline file**

If you have `glab` installed: `glab ci lint`.
Otherwise: paste the file into GitLab's **CI/CD → Editor** and confirm it validates.

Expected: "Syntax is correct".

- [ ] **Step 8.3: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: add GitLab pipeline (test, build, deploy-dev, manual deploy-prod)"
```

---

## Task 9: Protect branches, configure approvals

(Not files; repo/UI configuration. Do this once.)

- [ ] **Step 9.1: Protect `main`**

GitLab → **Settings → Repository → Protected branches** → add `main`:
- Allowed to merge: *Maintainers*
- Allowed to push: *No one*
- Code owner approval required: *Yes*

- [ ] **Step 9.2: Protect environments**

GitLab → **Settings → CI/CD → Protected environments** → protect `dev` and `prod`:
- Allowed to deploy: *Maintainers* (or a dedicated deploy role)
- Required approvals for `prod`: **1** (configures the manual-deploy gate).

- [ ] **Step 9.3: Verify CI/CD variables are marked correctly**

Under **Settings → CI/CD → Variables**, confirm every secret has **Protected** and (where applicable) **Masked** enabled. Without `Protected`, the values won't be exposed on the `main`-gated jobs; without `Masked`, they'll be printed in job logs if echoed.

No commit — settings-only.

---

## Task 10: Dry-run via a MR

- [ ] **Step 10.1: Open a throwaway MR**

Push a branch with a no-op change (e.g., whitespace in README). Open an MR.

- [ ] **Step 10.2: Verify test-stage jobs run**

In GitLab → **CI/CD → Pipelines** for the MR, confirm:
- `lint_typecheck_test:node` passes
- `lint_test:python` passes
- `validate:terraform` passes
- `supabase:lint` passes

Expected: all four green. `build:images` and `deploy:dev` should be **skipped** (rule is `main`-only).

- [ ] **Step 10.3: Merge → deploy**

Merge the MR. Watch:
- `build:images` runs (5 Cloud Build submissions).
- `deploy:dev` runs (Supabase migrations + `terraform apply`).
- `deploy:prod` appears as a **manual** button; do not click yet.

- [ ] **Step 10.4: Secret values**

Operator runs (once, per secret name):
```
echo -n '<value>' | gcloud secrets versions add <secret-name> --data-file=- --project=clinical-workflow-lakeway
```
Cloud Run services pick up the new versions on the next revision deploy or instance recycle.

- [ ] **Step 10.5: Click `deploy:prod`**

Once a human has reviewed the dev deploy, click the manual play button on `deploy:prod`. Required reviewers (from Task 9.2) must approve.

---

## Task 11: Plan F exit gate

- [ ] **Step 11.1: All pipelines green**

The latest pipeline on `main` should show all jobs either green (`test`, `build`, `deploy-dev`) or manual-pending (`deploy-prod`).

- [ ] **Step 11.2: Push**

```bash
git push origin main
```

---

## What's done after Plan F

- Dev and prod envs are Terraform-managed; five Cloud Run services, three Cloud Tasks queues, 15 Secret Manager secrets, and baseline alert policies are applied.
- GitLab CI/CD runs lint/typecheck/tests/tf-validate on every MR, builds images and deploys to dev on merge to `main`, and deploys to prod on a manual-approval job.
- GitLab authenticates to GCP via OIDC Workload Identity Federation — no service-account JSON keys anywhere.
- State lives in `gs://tfstate-clinical-workflow-lakeway/{dev,prod}`.

**Next:** Plan G instruments services with OpenTelemetry, adds per-call custom metrics and dashboards, replaces the E2E smoke placeholder with a real synthetic call assertion, and runs a scripted load test.
