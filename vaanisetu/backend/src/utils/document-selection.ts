export function documentTimestamp(item: Record<string, any>): number {
  const processed = Date.parse(String(item.processed_at ?? item.processedAt ?? ''));
  const uploaded = Date.parse(String(item.uploaded_at ?? item.uploadedAt ?? ''));
  const updated = Date.parse(String(item.updated_at ?? item.updatedAt ?? ''));
  const values = [processed, uploaded, updated].filter((value) => !Number.isNaN(value));
  return values.length ? Math.max(...values) : 0;
}

export function sortDocumentsNewestFirst<T extends Record<string, any>>(items: T[]): T[] {
  return [...items].sort((a, b) => documentTimestamp(b) - documentTimestamp(a));
}

export function normalizeDocumentType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isSuccessfulDocumentStatus(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return ['processed', 'verified', 'approved', 'completed'].includes(normalized);
}

export function getCurrentDocumentsByType<T extends Record<string, any>>(items: T[]): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const item of sortDocumentsNewestFirst(items)) {
    const type = normalizeDocumentType(item.document_type ?? item.documentType);
    if (!type) continue;
    const list = grouped.get(type) ?? [];
    list.push(item);
    grouped.set(type, list);
  }

  const current = new Map<string, T>();
  for (const [type, list] of grouped.entries()) {
    const hasExplicitCurrent = list.some((item) => typeof item.is_current === 'boolean');
    if (hasExplicitCurrent) {
      const explicit = list.find((item) => item.is_current === true && isSuccessfulDocumentStatus(item.status));
      if (explicit) current.set(type, explicit);
      continue;
    }

    const latestSuccessful = list.find((item) => isSuccessfulDocumentStatus(item.status));
    if (latestSuccessful) current.set(type, latestSuccessful);
  }
  return current;
}

export function getLatestAttemptByType<T extends Record<string, any>>(items: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const item of sortDocumentsNewestFirst(items)) {
    const type = normalizeDocumentType(item.document_type ?? item.documentType);
    if (type && !latest.has(type)) {
      latest.set(type, item);
    }
  }
  return latest;
}
