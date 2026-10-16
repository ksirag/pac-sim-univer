import { useCallback, useReducer } from 'react';
import { buildGeometry, EMPTY_PATH, type EditablePath } from '../../core/routeModel';

/** kind 'path' — редактирование по опорным точкам; 'raw' — готовая геометрия (GPX, рисование от руки). */
export interface EditorState {
  kind: 'path' | 'raw';
  path: EditablePath;
  raw: number[];
}

interface History {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

type Action =
  | { type: 'commit'; state: EditorState }
  | { type: 'patch'; fn: (s: EditorState) => EditorState }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; state: EditorState };

const LIMIT = 80;
export const EMPTY_EDITOR: EditorState = { kind: 'path', path: EMPTY_PATH, raw: [] };

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'commit':
      return { past: [...h.past.slice(-(LIMIT - 1)), h.present], present: a.state, future: [] };
    case 'patch':
      // без записи в историю: для асинхронно построенных участков по улицам
      return { ...h, present: a.fn(h.present) };
    case 'undo': {
      const prev = h.past[h.past.length - 1];
      return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
    }
    case 'redo': {
      const next = h.future[0];
      return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h;
    }
    case 'reset':
      return { past: [], present: a.state, future: [] };
  }
}

export function editorGeometry(s: EditorState): number[] {
  return s.kind === 'path' ? buildGeometry(s.path) : s.raw;
}

export function useEditor(initial: EditorState = EMPTY_EDITOR) {
  const [h, dispatch] = useReducer(reducer, { past: [], present: initial, future: [] });
  return {
    state: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    changed: h.past.length > 0,
    commit: useCallback((state: EditorState) => dispatch({ type: 'commit', state }), []),
    patch: useCallback((fn: (s: EditorState) => EditorState) => dispatch({ type: 'patch', fn }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    reset: useCallback((state: EditorState) => dispatch({ type: 'reset', state }), []),
  };
}
