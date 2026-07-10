import { useCallback, useEffect, useState } from 'react';
import type { HistoryEntry, HistoryStats } from '@flow/shared';
import { Button } from '@flow/ui';

/** Home screen: stats header + searchable dictation timeline (§5.3). */
export function HistoryPage() {
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const reload = useCallback(async (query: string) => {
    const page = await window.flow.invoke('history:query', {
      ...(query.trim() ? { search: query.trim() } : {}),
      limit: 50,
    });
    setEntries(page.entries);
    setNextBefore(page.nextBefore);
    setStats(await window.flow.invoke('history:stats'));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void reload(search), 200); // debounce
    return () => clearTimeout(timer);
  }, [search, reload]);

  useEffect(() => {
    // New dictations land while the window is open.
    return window.flow.on('dictation:result', () => void reload(search));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    if (!nextBefore) return;
    const page = await window.flow.invoke('history:query', {
      ...(search.trim() ? { search: search.trim() } : {}),
      before: nextBefore,
      limit: 50,
    });
    setEntries((prev) => [...prev, ...page.entries]);
    setNextBefore(page.nextBefore);
  };

  const remove = async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id)); // optimistic
    await window.flow.invoke('history:delete', id);
    setStats(await window.flow.invoke('history:stats'));
  };

  const groups = groupByDay(entries);

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <StatCard label="Words this week" value={stats?.wordsThisWeek ?? '–'} />
        <StatCard label="Dictations" value={stats?.dictationsThisWeek ?? '–'} />
        <StatCard label="Avg WPM" value={stats && stats.avgWpm > 0 ? stats.avgWpm : '–'} />
      </div>

      <input
        style={styles.search}
        placeholder="Search dictations…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {entries.length === 0 ? (
        <div style={styles.empty}>
          {search
            ? 'No dictations match your search.'
            : 'Hold your shortcut anywhere and speak — your dictations appear here.'}
        </div>
      ) : (
        groups.map(({ day, items }) => (
          <section key={day}>
            <h3 style={styles.day}>{day}</h3>
            {items.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} onDelete={() => void remove(entry.id)} />
            ))}
          </section>
        ))
      )}

      {nextBefore ? (
        <Button variant="ghost" size="sm" onClick={() => void loadMore()} style={{ marginTop: 12 }}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function HistoryRow({ entry, onDelete }: { entry: HistoryEntry; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const time = new Date(entry.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      style={{ ...styles.row, background: hover ? 'var(--bg-sunken)' : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={styles.rowText}>{entry.finalText}</div>
        <div style={styles.rowMeta}>
          {time} · {entry.wordCount} words · {(entry.durationMs / 1000).toFixed(1)}s
        </div>
      </div>
      {hover ? (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void window.flow.invoke('clipboard:copyResult', entry.id)}
          >
            Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={styles.stat}>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>{label}</div>
    </div>
  );
}

function groupByDay(entries: HistoryEntry[]): { day: string; items: HistoryEntry[] }[] {
  const groups: { day: string; items: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayLabel(entry.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }
  return groups;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

const styles: Record<string, React.CSSProperties> = {
  stat: {
    flex: 1,
    padding: 'var(--s-4)',
    borderRadius: 'var(--r-md)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
  },
  search: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 'var(--r-sm)',
    background: 'var(--bg-surface)',
    color: 'var(--fg-primary)',
    border: '1px solid var(--border-strong)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
    marginBottom: 16,
  },
  empty: {
    padding: 'var(--s-10) 0',
    color: 'var(--fg-tertiary)',
    textAlign: 'center',
  },
  day: {
    fontSize: 'var(--text-sm)',
    color: 'var(--fg-tertiary)',
    fontWeight: 500,
    margin: '20px 0 4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 'var(--r-sm)',
    marginLeft: -12,
  },
  rowText: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 'var(--text-base)',
  },
  rowMeta: { fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2 },
};
