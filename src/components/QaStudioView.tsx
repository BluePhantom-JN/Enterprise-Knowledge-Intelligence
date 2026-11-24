import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Database,
  Loader2,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { streamRagQuery } from '../lib/api.ts';
import type {
  ChatMessageItem,
  CitationChunk,
  CollectionItem,
  RetrievalConfig,
  UserRole,
} from '../types/rag.ts';
import { hasRoleAccess } from '../types/rag.ts';
import { CitedMarkdown } from './CitedMarkdown.tsx';
import { RetrievalInspector } from './RetrievalInspector.tsx';

interface QaStudioViewProps {
  userRole: UserRole;
  collections: CollectionItem[];
  totalDocuments: number;
  activeSessionId: number | null;
  messages: ChatMessageItem[];
  loadingMessages: boolean;
  inspectorOpen: boolean;
  seedingSample: boolean;
  onToggleInspector: (open: boolean) => void;
  onMessagesChange: (messages: ChatMessageItem[]) => void;
  onSessionCreatedOrUpdated: (sessionId: number) => void;
  onOpenDocumentChunks: (documentId: number) => void;
  onNavigateIngestion: () => void;
  onSeedSampleCorpus: () => Promise<void>;
}

const SUGGESTED_PROMPTS = [
  'What are the mandatory SEV-1 incident response milestones and timelines?',
  'Compare chunking guidelines for Markdown specs versus tabular CSV ledgers.',
  'Which cost center exceeded its Q3 budget and what caused the variance?',
  'How does Meridian combine pgvector semantic similarity with lexical full-text search?',
];

export function QaStudioView({
  userRole,
  collections,
  totalDocuments,
  activeSessionId,
  messages,
  loadingMessages,
  inspectorOpen,
  seedingSample,
  onToggleInspector,
  onMessagesChange,
  onSessionCreatedOrUpdated,
  onOpenDocumentChunks,
  onNavigateIngestion,
  onSeedSampleCorpus,
}: QaStudioViewProps) {
  const [queryInput, setQueryInput] = useState('');
  const [showControls, setShowControls] = useState(false);
  const [config, setConfig] = useState<RetrievalConfig>({
    collectionIds: [],
    topK: 6,
    semanticWeight: 0.7,
    minScore: 0.25,
  });

  const [streaming, setStreaming] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<CitationChunk[]>([]);
  const [streamingLatency, setStreamingLatency] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [inspectedMessageId, setInspectedMessageId] = useState<number | 'streaming' | null>(null);
  const [activeCitationNumber, setActiveCitationNumber] = useState<number | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const canEdit = hasRoleAccess(userRole, 'editor');

  useEffect(() => {
    if (messages.length > 0 && inspectedMessageId === null) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) {
        setInspectedMessageId(lastAssistant.id);
      }
    } else if (messages.length === 0) {
      setInspectedMessageId(null);
      setActiveCitationNumber(null);
    }
  }, [messages, inspectedMessageId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingAnswer]);

  const inspectedMessage =
    inspectedMessageId === 'streaming'
      ? null
      : messages.find((m) => m.id === inspectedMessageId) ??
        [...messages].reverse().find((m) => m.role === 'assistant') ??
        null;

  const inspectedCitations =
    inspectedMessageId === 'streaming'
      ? streamingCitations
      : inspectedMessage?.citations ?? [];

  const inspectedQueryText = (() => {
    if (inspectedMessageId === 'streaming') {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      return lastUser?.content ?? queryInput;
    }
    if (!inspectedMessage) return '';
    const idx = messages.findIndex((m) => m.id === inspectedMessage.id);
    if (idx > 0 && messages[idx - 1].role === 'user') {
      return messages[idx - 1].content;
    }
    return '';
  })();

  const inspectedConfig =
    inspectedMessageId === 'streaming' ? config : inspectedMessage?.retrievalConfig ?? null;

  const inspectedLatency =
    inspectedMessageId === 'streaming'
      ? streamingLatency
      : inspectedMessage?.latencyMs ?? null;

  const toggleCollectionScope = (colId: number) => {
    setConfig((prev) => {
      const exists = prev.collectionIds.includes(colId);
      return {
        ...prev,
        collectionIds: exists
          ? prev.collectionIds.filter((id) => id !== colId)
          : [...prev.collectionIds, colId],
      };
    });
  };

  const handleSubmit = async (overrideQuery?: string) => {
    const prompt = (overrideQuery ?? queryInput).trim();
    if (!prompt || streaming) return;

    setErrorMsg(null);
    setQueryInput('');
    setStreaming(true);
    setStreamingAnswer('');
    setStreamingCitations([]);
    setStreamingLatency(null);
    setInspectedMessageId('streaming');
    setActiveCitationNumber(null);

    const optimisticUserMsg: ChatMessageItem = {
      id: -Date.now(),
      sessionId: activeSessionId ?? 0,
      role: 'user',
      content: prompt,
      retrievalConfig: config,
      citations: [],
      latencyMs: null,
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...messages, optimisticUserMsg];
    onMessagesChange(nextHistory);

    let accumulated = '';
    await streamRagQuery({
      query: prompt,
      sessionId: activeSessionId,
      config,
      onMeta: (meta) => {
        setStreamingCitations(meta.citations);
        setStreamingLatency(meta.retrievalLatencyMs);
        if (meta.citations.length > 0 && !inspectorOpen) {
          onToggleInspector(true);
        }
      },
      onDelta: (piece) => {
        accumulated += piece;
        setStreamingAnswer(accumulated);
      },
      onDone: (payload) => {
        setStreaming(false);
        setStreamingAnswer('');
        setStreamingCitations([]);
        const updatedMessages = [...nextHistory, payload.message];
        onMessagesChange(updatedMessages);
        setInspectedMessageId(payload.message.id);
        onSessionCreatedOrUpdated(payload.sessionId);
      },
      onError: (err) => {
        setStreaming(false);
        setStreamingAnswer('');
        setErrorMsg(err);
      },
    });
  };

  const handleSelectCitation = (messageId: number | 'streaming', citationNumber: number) => {
    setInspectedMessageId(messageId);
    setActiveCitationNumber(citationNumber);
    if (!inspectorOpen) {
      onToggleInspector(true);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Main Reading & Query Column */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {/* Collection Scope & Retrieval Controls Strip */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-slate-500">Scope:</span>
              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, collectionIds: [] }))}
                className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  config.collectionIds.length === 0
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                All Collections ({collections.length})
              </button>
              {collections.map((col) => {
                const selected = config.collectionIds.includes(col.id);
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => toggleCollectionScope(col.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      selected
                        ? 'bg-blue-700 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {col.name}
                    <span className="ml-1.5 font-mono text-[11px] opacity-75 tabular-nums">
                      {col.documentCount}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowControls((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                showControls
                  ? 'border-blue-600 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Retrieval Controls
            </button>
          </div>

          {showControls && (
            <div className="mt-3 grid grid-cols-1 gap-4 border-t border-slate-200 pt-3 sm:grid-cols-3">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="rag-topk" className="font-medium text-slate-700">
                    Top-K Chunks
                  </label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {config.topK}
                  </span>
                </div>
                <input
                  id="rag-topk"
                  type="range"
                  min={3}
                  max={12}
                  step={1}
                  value={config.topK}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, topK: Number(e.target.value) }))
                  }
                  className="mt-1.5 w-full accent-blue-700"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="rag-weight" className="font-medium text-slate-700">
                    Hybrid Weight (Semantic / Lexical)
                  </label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {Math.round(config.semanticWeight * 100)} /{' '}
                    {Math.round((1 - config.semanticWeight) * 100)}
                  </span>
                </div>
                <input
                  id="rag-weight"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.semanticWeight}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, semanticWeight: Number(e.target.value) }))
                  }
                  className="mt-1.5 w-full accent-blue-700"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="rag-threshold" className="font-medium text-slate-700">
                    Minimum Relevance Threshold
                  </label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {config.minScore.toFixed(2)}
                  </span>
                </div>
                <input
                  id="rag-threshold"
                  type="range"
                  min={0}
                  max={0.75}
                  step={0.05}
                  value={config.minScore}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, minScore: Number(e.target.value) }))
                  }
                  className="mt-1.5 w-full accent-blue-700"
                />
              </div>
            </div>
          )}
        </div>

        {/* Conversation Viewport */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loadingMessages ? (
            <div className="mx-auto max-w-3xl space-y-6">
              {[1, 2].map((k) => (
                <div key={k} className="space-y-2.5">
                  <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
                  <div className="h-20 w-full animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 && !streaming ? (
            <div className="mx-auto flex max-w-2xl flex-col py-10">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 [text-wrap:balance]">
                Ask grounded questions across your enterprise knowledge base
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Every response fuses vector cosine similarity with PostgreSQL full-text search via Reciprocal Rank Fusion and links each factual claim to verifiable source chunks.
              </p>

              {totalDocuments === 0 ? (
                <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-6">
                  <div className="flex items-start gap-3">
                    <Database className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                    <div>
                      <h2 className="font-display text-sm font-semibold text-slate-900">
                        Your knowledge base has no indexed documents yet
                      </h2>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        {canEdit
                          ? 'Upload your own PDF, Markdown, TXT, or CSV documents—or index our 3-document sample enterprise corpus (SOC 2 Standard, Hybrid RAG Runbook, Q3 Cloud Spend CSV) through the live embedding pipeline.'
                          : 'Ask an Editor or Admin to ingest enterprise documents into your accessible collections to begin querying.'}
                      </p>
                      {canEdit && (
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={onSeedSampleCorpus}
                            disabled={seedingSample}
                            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 disabled:opacity-60"
                          >
                            {seedingSample ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Indexing Sample Corpus...
                              </>
                            ) : (
                              <>
                                <BookOpen className="h-3.5 w-3.5" />
                                Index Sample Enterprise Corpus
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={onNavigateIngestion}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-50"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Upload Your Own Files
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-7">
                  <div className="text-xs font-medium text-slate-500">
                    Suggested verification queries
                  </div>
                  <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleSubmit(prompt)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        <span>{prompt}</span>
                        <ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-45 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8 pb-4">
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="border-b border-slate-100 pb-4">
                      <div className="text-xs font-medium text-slate-500">Query</div>
                      <p className="mt-1 font-display text-base font-semibold text-slate-900">
                        {msg.content}
                      </p>
                    </div>
                  );
                }

                const isInspected = inspectedMessage?.id === msg.id && inspectedMessageId !== 'streaming';
                return (
                  <div key={msg.id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">Grounded Synthesis</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {msg.citations.length} source{msg.citations.length === 1 ? '' : 's'}
                        </span>
                        {msg.latencyMs !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{msg.latencyMs} ms</span>
                          </>
                        )}
                      </div>
                      {msg.citations.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setInspectedMessageId(msg.id);
                            setActiveCitationNumber(1);
                            onToggleInspector(true);
                          }}
                          className={`text-xs font-medium transition-colors ${
                            isInspected && inspectorOpen
                              ? 'text-blue-700'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {isInspected && inspectorOpen ? 'Viewing Evidence' : 'Inspect Evidence'}
                        </button>
                      )}
                    </div>

                    <CitedMarkdown
                      content={msg.content}
                      citations={msg.citations}
                      activeCitationNumber={isInspected ? activeCitationNumber : null}
                      onSelectCitation={(num) => handleSelectCitation(msg.id, num)}
                    />

                    {msg.citations.length > 0 && (
                      <div className="pt-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                          {msg.citations.slice(0, 6).map((c) => (
                            <button
                              key={c.chunkId}
                              type="button"
                              onClick={() => handleSelectCitation(msg.id, c.citationNumber)}
                              className="inline-flex items-center gap-1.5 text-left transition-colors hover:text-blue-700"
                            >
                              <span className="font-mono text-[11px] font-semibold text-blue-700 tabular-nums">
                                [{c.citationNumber}]
                              </span>
                              <span className="max-w-[200px] truncate">{c.documentTitle}</span>
                              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                {c.rrfScore.toFixed(2)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {streaming && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700" />
                    <span className="font-medium text-slate-800">
                      {streamingCitations.length > 0
                        ? `Synthesizing grounded answer from ${streamingCitations.length} retrieved chunks`
                        : 'Running hybrid vector and lexical retrieval'}
                    </span>
                  </div>
                  {streamingAnswer && (
                    <CitedMarkdown
                      content={streamingAnswer}
                      citations={streamingCitations}
                      activeCitationNumber={activeCitationNumber}
                      onSelectCitation={(num) => handleSelectCitation('streaming', num)}
                    />
                  )}
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{errorMsg}</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Sticky Query Composer */}
        <div className="border-t border-slate-200 bg-white px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="mx-auto flex max-w-3xl items-end gap-3"
          >
            <div className="relative flex-1">
              <textarea
                rows={1}
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Ask a question across your enterprise documents..."
                className="block max-h-36 min-h-[44px] w-full resize-none rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <button
              type="submit"
              disabled={streaming || queryInput.trim().length < 2}
              className="inline-flex h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
              Ask
            </button>
          </form>
        </div>
      </div>

      {/* Right-Hand Retrieval Inspector Rail */}
      {inspectorOpen && (
        <RetrievalInspector
          citations={inspectedCitations}
          activeCitationNumber={activeCitationNumber}
          queryText={inspectedQueryText}
          retrievalConfig={inspectedConfig}
          latencyMs={inspectedLatency}
          onSelectCitation={(num) => setActiveCitationNumber(num)}
          onOpenDocumentChunks={onOpenDocumentChunks}
          onClose={() => onToggleInspector(false)}
        />
      )}
    </div>
  );
}
