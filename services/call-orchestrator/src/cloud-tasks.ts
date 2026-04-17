import { CloudTasksClient } from '@google-cloud/tasks';
import { config, cloudTasksEnabled } from './config.js';

let client: CloudTasksClient | null = null;

function getClient(): CloudTasksClient {
  if (!client) client = new CloudTasksClient();
  return client;
}

export async function enqueuePullRecording(params: {
  callId: string;
  recordingSid: string;
}): Promise<string | null> {
  if (!cloudTasksEnabled) return null; // local dev: skip
  const c = getClient();
  const parent = c.queuePath(config.gcpProject, config.gcpTaskLocation, config.recordingPullQueue);
  const [task] = await c.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: config.recordingPullHandlerUrl,
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Svc-Token': config.internalSvcToken,
        },
        body: Buffer.from(JSON.stringify(params)).toString('base64'),
      },
      dispatchDeadline: { seconds: 600 },
    },
  });
  return task.name ?? '';
}
