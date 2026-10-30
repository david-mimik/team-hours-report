import { useEffect } from 'react';
import { initials, type Person } from './model';

export type Sort = { k: 'name' | 'hours'; d: 1 | -1 };

export function Who({ p }: { p: Person }) {
  return (
    <div className="who">
      <span className="av" style={{ background: p.color }}>{initials(p.name)}</span>
      {p.name}
      {p.former && <span className="former">Former</span>}
    </div>
  );
}

// tooltip attributes: title, optional body and amount
export const tip = (title: string, body?: string, amount?: string) => ({
  tabIndex: 0, 'data-tip': title, ...(body ? { 'data-tipb': body } : {}), ...(amount ? { 'data-tipa': amount } : {}),
});

export function SortTh({ k, label, sort, onSort, className = '' }: { k: Sort['k']; label: React.ReactNode; sort: Sort; onSort: (s: Sort) => void; className?: string }) {
  const on = sort.k === k;
  return (
    <th className={`sortable ${className}`} aria-sort={on ? (sort.d > 0 ? 'ascending' : 'descending') : 'none'} title={`Sort by ${k}`}
      onClick={() => onSort(on ? { k, d: (-sort.d) as 1 | -1 } : { k, d: k === 'name' ? 1 : -1 })}>
      {label}<span className="si">{on ? (sort.d > 0 ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}

export function sortRows<T>(rows: T[], sort: Sort, name: (r: T) => string, hours: (r: T) => number) {
  return rows.slice().sort((a, b) => (sort.k === 'name' ? sort.d * name(a).localeCompare(name(b)) : sort.d * (hours(a) - hours(b)) || name(a).localeCompare(name(b))));
}

// One tooltip for the page: any element with data-tip (title), data-tipb (body) and data-tipa (amount).
export function Tooltip() {
  useEffect(() => {
    const el = document.getElementById('tip')!;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const show = (t: HTMLElement) => {
      const d = t.dataset;
      el.innerHTML = `<b>${esc(d.tip!)}</b>${d.tipb ? `<div>${esc(d.tipb)}</div>` : ''}${d.tipa ? `<div class="amt">${esc(d.tipa)}</div>` : ''}`;
      el.style.opacity = '1';
    };
    const target = (e: Event) => (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
    const over = (e: PointerEvent) => { const t = target(e); if (t) show(t); };
    const move = (e: PointerEvent) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
      el.style.top = (e.clientY + 16 + h > innerHeight ? e.clientY - h - 12 : e.clientY + 16) + 'px';
    };
    const out = (e: Event) => { if (target(e)) el.style.opacity = '0'; };
    const focus = (e: FocusEvent) => {
      const t = target(e);
      if (!t) return;
      show(t);
      const b = t.getBoundingClientRect();
      el.style.left = Math.min(innerWidth - el.offsetWidth - 8, b.left) + 'px';
      el.style.top = (b.bottom + 8 + el.offsetHeight > innerHeight ? b.top - el.offsetHeight - 8 : b.bottom + 8) + 'px';
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') el.style.opacity = '0'; };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', out);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', out);
      document.removeEventListener('keydown', key);
    };
  }, []);
  return <div className="tip" id="tip" role="tooltip" />;
}

let toastTimer = 0;
export function toast(text: string) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 2000);
}
