function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  publicUrl: required('PUBLIC_URL'),
  workerWsUrl: required('WORKER_WS_URL'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  twilioAuthToken: required('TWILIO_AUTH_TOKEN'),
  internalSvcToken: required('INTERNAL_SVC_TOKEN'),
  // Cloud Tasks is optional in local dev; the orchestrator will skip enqueue
  // when these are absent.
  gcpProject: optional('GCP_PROJECT', ''),
  gcpTaskLocation: optional('GCP_TASK_LOCATION', 'us-central1'),
  recordingPullQueue: optional('RECORDING_PULL_QUEUE', 'recording-pull'),
  recordingPullHandlerUrl: optional('RECORDING_PULL_HANDLER_URL', ''),
} as const;

export const cloudTasksEnabled = !!(config.gcpProject && config.recordingPullHandlerUrl);
