import { useEffect, useRef } from 'react';

// Window-level keyboard shortcuts for a study screen. The handler always sees the latest
// state (it's kept in a ref), and the usual traps are handled here once so each screen doesn't
// have to: no shortcuts while typing in a field, none with Ctrl/Cmd/Alt held (browser and
// command-palette shortcuts stay theirs), and Space/Enter are left alone when a button or
// link has focus, since the browser already "clicks" it and we'd otherwise fire twice.
export function useKeys(handler) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    function onKeyDown(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if ((e.key === ' ' || e.key === 'Enter') && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return;
      handlerRef.current?.(e);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
