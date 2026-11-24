import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Search, ShieldCheck, Trash2 } from 'lucide-react';
import {
  deleteCollectionApi,
  fetchAdminUsers,
  fetchAuditLogs,
  updateAdminUserRole,
} from '../lib/api.ts';
import type { AuditLogItem, CollectionItem, UserProfile, UserRole } from '../types/rag.ts';

interface AdminGovernanceViewProps {
  currentUserId: number;
  collections: CollectionItem[];
  onCollectionsChanged: () => Promise<void>;
  onProfileChanged: () => Promise<void>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ACTION_LABELS: Record<string, string> = {
  rag_query: 'Hybrid Query',
  document_upload: 'Document Index',
  document_reindex: 'Re-index',
  document_delete: 'Delete Doc',
  role_update: 'Role Change',
  collection_create: 'New Collection',
};

export function AdminGovernanceView({
  currentUserId,
  collections,
  onCollectionsChanged,
  onProfileChanged,
}: AdminGovernanceViewProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [deletingColId, setDeletingColId] = useState<number | null>(null);

  const loadGovernance = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [userList, auditList] = await Promise.all([fetchAdminUsers(), fetchAuditLogs()]);
      setUsers(userList);
      setLogs(auditList);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load governance data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGovernance();
  }, []);

  const handleRoleChange = async (userId: number, role: UserRole) => {
    setUpdatingUserId(userId);
    setErrorMsg(null);
    try {
      const updated = await updateAdminUserRole(userId, role);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      const refreshedLogs = await fetchAuditLogs();
      setLogs(refreshedLogs);
      if (userId === currentUserId) {
        await onProfileChanged();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update role.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDeleteCollection = async (id: number) => {
    setDeletingColId(id);
    setErrorMsg(null);
    try {
      await deleteCollectionApi(id);
      await onCollectionsChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete collection.');
    } finally {
      setDeletingColId(null);
    }
  };

  const filteredLogs = auditSearch.trim()
    ? logs.filter(
        (l) =>
          l.userEmail.toLowerCase().includes(auditSearch.trim().toLowerCase()) ||
          l.resourceSummary.toLowerCase().includes(auditSearch.trim().toLowerCase()) ||
          l.collectionScope.toLowerCase().includes(auditSearch.trim().toLowerCase())
      )
    : logs;

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50 px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900">
            Access Control &amp; Query Audit
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage workspace role assignments (Admin, Editor, Viewer), collection visibility policies, and retrieval audit history.
          </p>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Member Roles Table */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-500" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Workspace Members &amp; Roles
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {users.length} member{users.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                    <th className="px-5 py-2.5 font-display font-semibold">Member</th>
                    <th className="px-5 py-2.5 font-display font-semibold">Email</th>
                    <th className="px-5 py-2.5 text-right font-display font-semibold">
                      Last Active
                    </th>
                    <th className="px-5 py-2.5 text-right font-display font-semibold">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((member) => (
                    <tr key={member.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {member.displayName}
                        {member.id === currentUserId && (
                          <span className="ml-2 text-[11px] font-normal text-slate-500">(You)</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{member.email}</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-500 tabular-nums">
                        {formatDateTime(member.lastActiveAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <select
                          aria-label={`Role for ${member.email}`}
                          value={member.role}
                          disabled={updatingUserId === member.id}
                          onChange={(e) => handleRoleChange(member.id, e.target.value as UserRole)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none disabled:opacity-50"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Collection Visibility Matrix */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Collection Visibility Policies
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                  <th className="px-5 py-2.5 font-display font-semibold">Collection</th>
                  <th className="px-5 py-2.5 font-display font-semibold">Minimum Role</th>
                  <th className="px-5 py-2.5 text-right font-display font-semibold">Documents</th>
                  <th className="px-5 py-2.5 text-right font-display font-semibold">Chunks</th>
                  <th className="px-5 py-2.5 text-right font-display font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {collections.map((col) => (
                  <tr key={col.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{col.name}</div>
                      {col.description && (
                        <div className="mt-0.5 text-[11px] text-slate-500">{col.description}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 capitalize text-slate-700">{col.minRole}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-800">
                      {col.documentCount}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-800">
                      {col.chunkCount}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        disabled={deletingColId === col.id || collections.length <= 1}
                        onClick={() => handleDeleteCollection(col.id)}
                        title={
                          collections.length <= 1
                            ? 'At least one collection must remain'
                            : `Delete ${col.name}`
                        }
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Audit Trail */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Query &amp; Ingestion Audit Log
            </h2>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Filter audit activity..."
                className="w-56 rounded-md border border-slate-300 bg-white py-1 pr-3 pl-8 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No audit events recorded yet.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                    <th className="px-5 py-2.5 font-display font-semibold">Timestamp</th>
                    <th className="px-5 py-2.5 font-display font-semibold">Actor</th>
                    <th className="px-5 py-2.5 font-display font-semibold">Event</th>
                    <th className="px-5 py-2.5 font-display font-semibold">Summary</th>
                    <th className="px-5 py-2.5 text-right font-display font-semibold">Top RRF</th>
                    <th className="px-5 py-2.5 text-right font-display font-semibold">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-2.5 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-5 py-2.5 text-slate-700">{log.userEmail}</td>
                      <td className="px-5 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </td>
                      <td className="px-5 py-2.5 max-w-md truncate text-slate-600">
                        {log.resourceSummary}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-700 tabular-nums">
                        {log.topScore !== null ? log.topScore.toFixed(3) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {log.latencyMs !== null ? `${log.latencyMs} ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
