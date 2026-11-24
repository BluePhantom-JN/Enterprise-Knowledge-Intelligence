import { extractText } from 'unpdf';
import type { SupportedFileType } from '../types/rag.ts';

const EXTENSION_MAP: Record<string, SupportedFileType> = {
  pdf: 'pdf',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
  csv: 'csv',
};

export function detectFileType(fileName: string): SupportedFileType | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MAP[ext] ?? null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function formatCsvForRag(rawCsv: string): string {
  const lines = rawCsv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  const headers = parseCsvLine(lines[0]);
  const headerSummary = `Columns: ${headers.join(' | ')}`;
  const rows: string[] = [headerSummary];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const pairs = headers.map((h, idx) => `${h || `Col ${idx + 1}`}: ${values[idx] ?? ''}`);
    rows.push(`Row ${i}: ${pairs.join(' | ')}`);
  }

  return rows.join('\n');
}

export async function extractDocumentContent(
  buffer: Buffer,
  fileType: SupportedFileType
): Promise<string> {
  if (fileType === 'pdf') {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    const text = Array.isArray(result.text) ? result.text.join('\n\n') : String(result.text ?? '');
    return text.replace(/\u0000/g, '').trim();
  }

  const rawText = buffer.toString('utf-8').replace(/\u0000/g, '').trim();
  if (fileType === 'csv') {
    return formatCsvForRag(rawText);
  }
  return rawText;
}
