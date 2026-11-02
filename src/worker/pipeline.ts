import { buildBoard } from '../core/board';
import type { Board, InputFile, ParseKeys } from '../core/types';
import { classify, expandArchives, parseASC, parseBoardFile } from '../parsers';

export type LoadResult =
  | { type: 'board'; board: Board | null; attachments: InputFile[] }
  | { type: 'choose'; candidates: string[] };

const display = (n: string) => n.split(/[\\/]/).pop() ?? n;

/**
 * Full load pipeline: archives → classification → (optional user choice) → parse → normalise.
 * PDFs found next to the board are returned as attachments (schematics).
 */
export function loadFiles(files: InputFile[], keys: ParseKeys, pick?: string): LoadResult {
  const expanded = expandArchives(files);
  const { boards, asc, pdfs } = classify(expanded);
  const candidates = [...boards.map((b) => b.name), ...(asc ? ['ASC (format/pins/nails.asc)'] : [])];

  if (!candidates.length) {
    if (pdfs.length) {
      return { type: 'board', board: null, attachments: pdfs };
    }
    throw new Error('No se encontró ningún boardview compatible en los archivos seleccionados.');
  }

  const chosen = pick && candidates.includes(pick) ? pick : candidates.length === 1 ? candidates[0] : undefined;
  if (!chosen) return { type: 'choose', candidates };

  const raw = chosen.startsWith('ASC (')
    ? parseASC(asc!)
    : parseBoardFile(boards.find((b) => b.name === chosen)!, keys);
  const name = chosen.startsWith('ASC (') ? display(files[0]?.name ?? 'board.asc') : display(chosen);
  return { type: 'board', board: buildBoard(raw, name), attachments: pdfs };
}
