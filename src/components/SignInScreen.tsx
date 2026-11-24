import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

export function SignInScreen() {
  const { signInWithGoogle, authError } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="flex items-center justify-between gap-8 border-b border-slate-200 px-6 py-4 lg:px-10">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          Meridian
        </span>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={signingIn}
          className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-blue-800 disabled:opacity-60"
        >
          {signingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Sign in with Google
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-12 px-6 py-16 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-7">
          <p className="text-xs font-medium text-slate-500">
            Enterprise Retrieval-Augmented Generation
          </p>
          <h1 className="mt-3 max-w-xl font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
            Grounded answers backed by hybrid vector search and verifiable citations
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            Meridian Knowledge Studio unifies multi-format document ingestion, configurable chunking pipelines, PostgreSQL pgvector hybrid retrieval, and role-based access control in a single auditable workspace.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-6 border-t border-slate-200 pt-8 sm:grid-cols-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                01. Hybrid RRF Retrieval
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Fuses 768-dimensional semantic embeddings with PostgreSQL full-text search so both acronyms and conceptual queries surface exact passages.
              </p>
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                02. Chunking Workbench
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Ingest PDF, Markdown, TXT, and CSV files with live segmentation previews and one-click re-indexing without re-uploading.
              </p>
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                03. Role-Based Governance
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Enforces Admin, Editor, and Viewer permissions across collections, endpoints, and full query audit trails.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-8">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Sign in to Workspace
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Authenticate with your Google account to access your permitted enterprise collections and Q&amp;A sessions.
            </p>

            {authError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn}
              className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-md bg-blue-700 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {signingIn ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <span>Continue with Google</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
              Protected by verified identity tokens and role-scoped server retrieval.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
