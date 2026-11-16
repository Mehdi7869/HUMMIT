import {
  ActivityItem,
  Analysis,
  Composition,
  Lyrics,
  Project,
  Recording,
} from '../types/soundscribe';

export function formatDuration(seconds: number, withTenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return withTenths ? '00:00.0' : '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  const base = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return withTenths ? `${base}.${tenths}` : base;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function deriveCreativeActivity(params: {
  recordings: Recording[];
  projects: Project[];
  analyses: Analysis[];
  lyrics: Lyrics[];
  compositions: Composition[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const r of params.recordings) {
    items.push({
      id: `rec-${r.id}`,
      type: 'recording',
      title: r.title,
      subtitle: `Captured ${formatDuration(r.duration)} audio sketch`,
      timestamp: r.created_at,
      targetId: r.id,
    });
  }
  for (const a of params.analyses) {
    const rec = params.recordings.find((r) => r.id === a.recording_id);
    items.push({
      id: `ana-${a.id}`,
      type: 'analysis',
      title: rec ? `${rec.title} (Analysis v${a.version})` : `Audio Analysis v${a.version}`,
      subtitle: a.mood.length ? `Detected ${a.mood.slice(0, 2).join(', ')}` : 'AI analysis saved',
      timestamp: a.created_at,
      targetId: a.recording_id,
    });
  }
  for (const l of params.lyrics) {
    items.push({
      id: `lyr-${l.id}`,
      type: 'lyrics',
      title: l.title,
      subtitle: `Lyric sheet saved · v${l.version}`,
      timestamp: l.updated_at,
      targetId: l.id,
    });
  }
  for (const c of params.compositions) {
    items.push({
      id: `cmp-${c.id}`,
      type: 'composition',
      title: c.title,
      subtitle: `Composition blueprint · v${c.version}`,
      timestamp: c.updated_at,
      targetId: c.recording_id || c.id,
    });
  }
  for (const p of params.projects) {
    items.push({
      id: `prj-${p.id}`,
      type: 'project',
      title: p.name,
      subtitle: `Project (${p.status})`,
      timestamp: p.updated_at,
      targetId: p.id,
    });
  }

  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 12);
}
