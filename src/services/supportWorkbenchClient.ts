const HAR_BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';

const SUPPORT_BRIDGE_BASE = `${HAR_BACKEND_URL.replace(/\/$/, '')}/api/support-workbench`;

export type SupportWorkbenchSessionResponse = {
  session: {
    id: string;
    cwd: string;
    status: string;
  };
  snapshot: unknown;
};

export type SupportWorkbenchAttachmentResponse = {
  accepted: boolean;
  attachments: unknown[];
  snapshot: unknown;
};

type CreateSupportWorkbenchSessionInput = {
  cwd?: string;
  sessionId?: string;
};

export async function createSupportWorkbenchSession(
  input: CreateSupportWorkbenchSessionInput = {}
): Promise<SupportWorkbenchSessionResponse> {
  const response = await fetch(`${SUPPORT_BRIDGE_BASE}/session`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return readJson<SupportWorkbenchSessionResponse>(response);
}

export async function uploadSupportWorkbenchAttachments(
  sessionId: string,
  files: File[]
): Promise<SupportWorkbenchAttachmentResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(
    `${SUPPORT_BRIDGE_BASE}/session/${encodeURIComponent(sessionId)}/attachments`,
    {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }
  );

  return readJson<SupportWorkbenchAttachmentResponse>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : response.statusText || 'Support Workbench request failed';
    throw new Error(message);
  }

  return payload as T;
}
