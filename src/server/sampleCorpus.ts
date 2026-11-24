import type { ChunkStrategy, SupportedFileType } from '../types/rag.ts';

export interface SampleDocumentSpec {
  collectionSlug: string;
  title: string;
  fileName: string;
  fileType: SupportedFileType;
  chunkStrategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  content: string;
}

export const SAMPLE_ENTERPRISE_DOCUMENTS: SampleDocumentSpec[] = [
  {
    collectionSlug: 'security-compliance',
    title: 'SOC 2 Type II Access Control & Incident Response Standard',
    fileName: 'soc2-access-incident-standard.md',
    fileType: 'md',
    chunkStrategy: 'markdown',
    chunkSize: 800,
    chunkOverlap: 120,
    content: `# SOC 2 Type II Access Control & Incident Response Standard

## 1. Role-Based Access Governance
Meridian enforces strict least-privilege role-based access control (RBAC) across all production data stores and internal knowledge repositories. Every user identity must authenticate through federated Single Sign-On (SSO) with hardware-backed multi-factor authentication.

Access tiers are defined across three organizational roles:
- **Admin**: Authorized to provision collections, assign user roles, rotate encryption keys, and export immutable audit logs. Minimum two designated Admins must exist in production at all times.
- **Editor**: Authorized to ingest, re-chunk, update, and retire knowledge documents within assigned business collections.
- **Viewer**: Read-only search and retrieval privileges scoped exclusively to collections permitted for their role level.

Quarterly access recertification reviews occur on the first business Monday of January, April, July, and October. Any dormant account inactive for 45 consecutive days is automatically suspended until re-approved by Security Operations.

## 2. Encryption & Data Residency Policy
All ingested enterprise documents, chunk text segments, and 768-dimensional vector embeddings are encrypted at rest using AES-256-GCM managed keys and encrypted in transit using TLS 1.3. Customer-managed key rotation executes automatically every 90 days without service interruption.

Raw binary uploads are parsed in ephemeral memory buffers and never persisted to unencrypted local scratch disks. Database backups are replicated within the primary regional jurisdiction and retained for 35 days for point-in-time recovery (PITR).

## 3. Severity-1 Incident Response SLA
A Severity-1 (SEV-1) security incident includes any confirmed unauthorized disclosure of confidential customer data, privilege escalation bypass, or prolonged outage exceeding 15 minutes in core retrieval APIs.

Mandatory SEV-1 response milestones:
- **T+0 to T+15 minutes**: On-call Security Commander acknowledges page, declares incident channel, and isolates compromised credentials or IP ranges.
- **T+60 minutes**: Initial customer impact assessment and executive briefing distributed to Legal and VP Engineering.
- **T+24 hours**: Formal written notification issued to affected enterprise tenants in compliance with contractual DPA notice windows.
- **T+5 business days**: Blameless Root Cause Analysis (RCA) published with tracked preventive engineering tickets.`,
  },
  {
    collectionSlug: 'engineering-architecture',
    title: 'Hybrid RAG Retrieval & Vector Indexing Runbook',
    fileName: 'hybrid-rag-indexing-runbook.txt',
    fileType: 'txt',
    chunkStrategy: 'recursive',
    chunkSize: 850,
    chunkOverlap: 140,
    content: `Hybrid RAG Retrieval & Vector Indexing Runbook
Document ID: ENG-RUNBOOK-412
Owner: Platform Search & AI Infrastructure

1. Overview of Hybrid Retrieval Architecture
Pure dense vector retrieval struggles with exact part numbers, error codes (such as ERR_POOL_429), contract identifiers, and internal acronyms. Conversely, pure lexical full-text search misses semantic paraphrases and cross-domain synonyms. Meridian combines PostgreSQL pgvector cosine similarity with PostgreSQL full-text search (ts_rank_cd over English tsvector lexemes) using weighted Reciprocal Rank Fusion (RRF) with constant k = 60.

2. Chunking Guidelines by Document Format
Engineering benchmarks across 12,000 internal enterprise documents established the following optimal defaults:
- Policy manuals and technical prose (PDF / TXT): Recursive paragraph chunking at 800 to 1,000 characters with 150 characters of overlap preserves cross-sentence antecedents without diluting cosine similarity.
- Markdown architecture specs: Heading-aware Markdown chunking keeps section titles attached to every child chunk so citations accurately surface exact specification subsections.
- Tabular financial and operational CSV ledgers: Row-group chunking preserves the column header schema on every chunk so numerical queries never lose column semantics.

3. HNSW Vector Index Maintenance
Production PostgreSQL clusters index 768-dimensional gemini-embedding-2 vectors with an HNSW cosine index (vector_cosine_ops). When bulk re-indexing exceeds 50,000 chunks, execute re-indexing in batches of 16 chunks per embedding API request to maintain steady p95 latency below 450 milliseconds and prevent upstream rate limiting.

4. Citation Grounding Safeguards
The generation layer instructs the synthesis model to cite every factual statement using bracketed numeric anchors ([1], [2]) corresponding to retrieved chunk rankings. If no chunk surpasses the configured minimum relevance score threshold, the system refuses speculation and advises broadening the collection scope or lowering the threshold.`,
  },
  {
    collectionSlug: 'operations-finance',
    title: 'FY2026 Q3 Enterprise Cloud Infrastructure & AI Spend Ledger',
    fileName: 'fy26-q3-cloud-spend-ledger.csv',
    fileType: 'csv',
    chunkStrategy: 'csv_rows',
    chunkSize: 700,
    chunkOverlap: 100,
    content: `Columns: Cost_Center | Service_Name | Region | Monthly_Budget_USD | Actual_Q3_Spend_USD | Variance_Pct | Owner_Team | Notes
Row 1: CC-104-PLATFORM | Cloud SQL PostgreSQL (pgvector) | asia-south1 | 4200 | 11850 | -6.0% | Data Infrastructure | Includes HNSW vector memory buffer and automated 35-day PITR snapshots
Row 2: CC-104-PLATFORM | Gemini Embedding & Synthesis API | global | 6500 | 18420 | -5.5% | AI Platform | Batch-16 embedding optimization reduced Q3 token spend by 18%
Row 3: CC-208-SECURITY | Identity & SSO Federation | us-central1 | 1800 | 5310 | -1.7% | Security Ops | Covers 420 enterprise seats and hardware MFA attestation
Row 4: CC-312-COMPUTE | Cloud Run API & Ingestion Workers | asia-south1 | 3100 | 9890 | +6.3% | Core Engineering | Spike in August caused by full archive PDF re-chunking migration
Row 5: CC-401-ANALYTICS | Audit Warehouse & Compliance Exports | us-central1 | 1500 | 4380 | -2.7% | Governance | Immutable query audit storage for SOC 2 Type II evidence package
Row 6: CC-515-SUPPORT | Enterprise SLA Monitoring & PagerDuty | global | 950 | 2850 | 0.0% | Site Reliability | 24/7 SEV-1 alerting covering 15-minute response SLA`,
  },
];
