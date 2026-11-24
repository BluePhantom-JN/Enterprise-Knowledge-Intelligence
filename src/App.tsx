import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  PanelRight,
  Plus,
  Shield,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { SignInScreen } from './components/SignInScreen.tsx';
import { QaStudioView } from './components/QaStudioView.tsx';
import { IngestionWorkbenchView } from './components/IngestionWorkbenchView.tsx';
import { DocumentCatalogView } from './components/DocumentCatalogView.tsx';
import { ChunkExplorerView } from './components/ChunkExplorerView.tsx';
import { AdminGovernanceView } from './components/AdminGovernanceView.tsx';
import {
  deleteSessionApi,
  fetchCollections,
  fetchDocuments,
  fetchSessionMessages,
  fetchSessions,
  seedSampleCorpusApi,
} from './lib/api.ts';
import type {
  ChatMessageItem,
  ChatSessionItem,
  CollectionItem,
  DocumentItem,
} from './types/rag.ts';
import { hasRoleAccess } from './types/rag.ts';

type WorkspaceSection = 'qa' | 'ingest' | 'catalog' | 'admin';

function WorkspaceShell() {
  const { firebaseUser, profile, loading, logout, refreshProfile } = useAuth();

  const [section, setSection] = useState<WorkspaceSection>('qa');
  const [inspectingDocId, setInspectingDocId] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [seedingSample, setSeedingSample] = useState(false);

  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const [cols, docs, sess] = await Promise.all([
        fetchCollections(),
        fetchDocuments(),
        fetchSessions(),
      ]);
      setCollections(cols);
      setDocuments(docs);
      setSessions(sess);
    } catch (error) {
      console.error('Workspace data sync failed:', error);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    if (profile) {
      loadWorkspaceData();
    }
  }, [profile, loadWorkspaceData]);

  const handleSelectSession = async (sessionId: number) => {
    setActiveSessionId(sessionId);
    setSection('qa');
    setInspectingDocId(null);
    setMobileNavOpen(false);
    setLoadingMessages(true);
    try {
      const loaded = await fetchSessionMessages(sessionId);
      setMessages(loaded);
    } catch (error) {
      console.error('Failed to load session:', error);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleNewQuery = () => {
    setActiveSessionId(null);
    setMessages([]);
    setSection('qa');
    setInspectingDocId(null);
    setMobileNavOpen(false);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    try {
      await deleteSessionApi(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionCreatedOrUpdated = async (sessionId: number) => {
    setActiveSessionId(sessionId);
    try {
      const sess = await fetchSessions();
      setSessions(sess);
    } catch {
      // Non-blocking refresh
    }
  };

  const handleSeedSampleCorpus = async () => {
    if (seedingSample) return;
    setSeedingSample(true);
    try {
      const res = await seedSampleCorpusApi();
      await loadWorkspaceData();
      await refreshProfile();
      showToast(
        res.count > 0
          ? `Indexed ${res.count} sample enterprise documents (${res.latencyMs} ms).`
          : 'Sample enterprise corpus is already indexed.'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to index sample corpus.');
    } finally {
      setSeedingSample(false);
    }
  };

  const handleOpenDocumentChunks = (documentId: number) => {
    setInspectingDocId(documentId);
    setSection('catalog');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-2.5 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
          <span>Loading Meridian Knowledge Studio...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <SignInScreen />;
  }

  const isAdmin = profile.role === 'admin';
  const canEdit = hasRoleAccess(profile.role, 'editor');

  const breadcrumbLabel = (() => {
    if (inspectingDocId !== null) {
      const found = documents.find((d) => d.id === inspectingDocId);
      return `Document Catalog / ${found?.title ?? `Document #${inspectingDocId}`}`;
    }
    switch (section) {
      case 'qa':
        return 'Q&A Studio';
      case 'ingest':
        return 'Ingestion Workbench';
      case 'catalog':
        return 'Document Catalog';
      case 'admin':
        return 'Access & Audit';
    }
  })();

  const navItems: Array<{
    id: WorkspaceSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    { id: 'qa', label: 'Q&A Studio', icon: MessageSquare, visible: true },
    { id: 'ingest', label: 'Ingestion Workbench', icon: Upload, visible: true },
    { id: 'catalog', label: 'Document Catalog', icon: FileText, visible: true },
    { id: 'admin', label: 'Access & Audit', icon: Shield, visible: isAdmin },
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-slate-50/80">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
        <button
          type="button"
          onClick={handleNewQuery}
          className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Meridian
        </button>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
          className="rounded p-1 text-slate-500 hover:bg-slate-200/60 lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary Nav */}
      <nav className="space-y-0.5 px-3 py-3">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const active = section === item.id && (item.id !== 'catalog' || inspectingDocId === null);
            const activeCatalogChild = item.id === 'catalog' && inspectingDocId !== null;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  setInspectingDocId(null);
                  setMobileNavOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  active || activeCatalogChild
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                    : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                <span>{item.label}</span>
              </button>
            );
          })}
      </nav>

      {/* Recent Q&A Sessions */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 px-3 pt-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-[11px] font-medium text-slate-500">Recent Queries</span>
          <button
            type="button"
            onClick={handleNewQuery}
            title="Start new query"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        <div className="flex-1 space-y-0.5 overflow-y-auto pb-3">
          {sessions.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-400">No saved queries yet.</p>
          ) : (
            sessions.map((sess) => {
              const isCurrent = section === 'qa' && activeSessionId === sess.id;
              return (
                <div
                  key={sess.id}
                  onClick={() => handleSelectSession(sess.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectSession(sess.id);
                    }
                  }}
                  className={`group flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    isCurrent
                      ? 'bg-blue-50 font-medium text-blue-900'
                      : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
                  }`}
                >
                  <span className="truncate">{sess.title}</span>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteSession(e, sess.id)}
                    aria-label="Delete session"
                    className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Account Footer */}
      <div className="border-t border-slate-200 bg-white px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-display text-xs font-semibold text-slate-900">
              {profile.displayName}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="capitalize font-medium text-slate-700">{profile.role}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{profile.email}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-slate-900">
      {/* Desktop Left Rail */}
      <div className="hidden w-[256px] shrink-0 lg:block">{sidebarContent}</div>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/30"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-50 w-[264px] max-w-[85vw]">{sidebarContent}</div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Single-Row Top Header Contract */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-slate-200 bg-white px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-400 whitespace-nowrap">Meridian</span>
              <span aria-hidden="true">/</span>
              <span className="truncate font-display font-semibold text-slate-900">
                {breadcrumbLabel}
              </span>
            </div>
          </div>

          {/* Single Contextual Primary Action */}
          <div className="shrink-0">
            {section === 'qa' ? (
              <button
                type="button"
                onClick={() => setInspectorOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  inspectorOpen
                    ? 'border-blue-600 bg-blue-50 text-blue-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <PanelRight className="h-3.5 w-3.5" />
                {inspectorOpen ? 'Hide Inspector' : 'Retrieval Inspector'}
              </button>
            ) : section === 'catalog' && inspectingDocId === null && canEdit ? (
              <button
                type="button"
                onClick={() => setSection('ingest')}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Document
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNewQuery}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Open Q&amp;A Studio
              </button>
            )}
          </div>
        </header>

        {/* Active View */}
        <main className="relative flex min-h-0 flex-1 overflow-hidden">
          {section === 'qa' && (
            <QaStudioView
              userRole={profile.role}
              collections={collections}
              totalDocuments={documents.length}
              activeSessionId={activeSessionId}
              messages={messages}
              loadingMessages={loadingMessages}
              inspectorOpen={inspectorOpen}
              seedingSample={seedingSample}
              onToggleInspector={setInspectorOpen}
              onMessagesChange={setMessages}
              onSessionCreatedOrUpdated={handleSessionCreatedOrUpdated}
              onOpenDocumentChunks={handleOpenDocumentChunks}
              onNavigateIngestion={() => setSection('ingest')}
              onSeedSampleCorpus={handleSeedSampleCorpus}
            />
          )}

          {section === 'ingest' && (
            <IngestionWorkbenchView
              userRole={profile.role}
              collections={collections}
              onCollectionsChanged={async () => {
                await loadWorkspaceData();
                await refreshProfile();
              }}
              onDocumentUploaded={async (doc) => {
                await loadWorkspaceData();
                await refreshProfile();
                showToast(`Indexed "${doc.title}" (${doc.chunkCount} chunks).`);
              }}
              onInspectDocument={handleOpenDocumentChunks}
            />
          )}

          {section === 'catalog' && inspectingDocId === null && (
            <DocumentCatalogView
              userRole={profile.role}
              collections={collections}
              documents={documents}
              loading={loadingDocs}
              seedingSample={seedingSample}
              onRefresh={async () => {
                await loadWorkspaceData();
                await refreshProfile();
              }}
              onInspectDocument={(id) => setInspectingDocId(id)}
              onNavigateIngestion={() => setSection('ingest')}
              onSeedSampleCorpus={handleSeedSampleCorpus}
            />
          )}

          {section === 'catalog' && inspectingDocId !== null && (
            <ChunkExplorerView
              documentId={inspectingDocId}
              userRole={profile.role}
              onBack={() => setInspectingDocId(null)}
              onReindexed={async () => {
                await loadWorkspaceData();
                showToast('Document chunks and embeddings updated.');
              }}
            />
          )}

          {section === 'admin' && isAdmin && (
            <AdminGovernanceView
              currentUserId={profile.id}
              collections={collections}
              onCollectionsChanged={async () => {
                await loadWorkspaceData();
                await refreshProfile();
              }}
              onProfileChanged={refreshProfile}
            />
          )}

          {toast && (
            <div className="fixed right-5 bottom-5 z-50 rounded-md border border-slate-200 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-md">
              {toast}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceShell />
    </AuthProvider>
  );
}
