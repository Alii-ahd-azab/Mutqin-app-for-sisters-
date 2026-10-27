import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { ALL_QUARTERS, QuarterDetail } from '../data/quranData';

// Arabic search: ignore diacritics/Quranic marks and alef/ya/ta-marbuta variants; accept Arabic-Indic digits.
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_MARKS, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۞۩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Short preview of where a quarter begins (first words of its opening ayah). */
export function quarterOpening(q: QuarterDetail, words = 5): string {
  const text = q.ayahText.replace(/[۞۩]/g, '').trim().split(/\s+/).slice(0, words).join(' ');
  return text;
}

const INDEX = ALL_QUARTERS.map((q) => ({
  q,
  haystack: normalizeArabic(`${q.surahName} ${q.ayahText}`),
}));

interface QuarterPickerProps {
  id: string;
  label: string;
  value: number | null;
  onChange: (quarter: number) => void;
  // Quarters outside [min, max] are shown but cannot be chosen (e.g. «إلى» before «من»).
  min?: number;
  max?: number;
  tone: 'from' | 'to';
  placeholder?: string;
}

/**
 * Searchable selector for one Quran quarter (1–240) from the project's quarter data. Type a quarter
 * number («23»), a surah name or words of the opening ayah. Keyboard: ↑ ↓ Enter Esc.
 */
export const QuarterPicker: React.FC<QuarterPickerProps> = ({
  id,
  label,
  value,
  onChange,
  min = 1,
  max = 240,
  tone,
  placeholder = 'اختاري الربع',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = normalizeArabic(query);
    if (!q) return ALL_QUARTERS;
    const stripped = q.replace(/^الربع\s*/, '');
    if (/^\d+$/.test(stripped)) {
      const n = Number(stripped);
      // Exact number first, then numbers that start with what was typed.
      const exact = ALL_QUARTERS.filter((x) => x.number === n);
      const prefix = ALL_QUARTERS.filter((x) => x.number !== n && String(x.number).startsWith(stripped));
      return [...exact, ...prefix];
    }
    return INDEX.filter((x) => x.haystack.includes(q)).map((x) => x.q);
  }, [query]);

  const selectable = (n: number) => n >= min && n <= max;

  useEffect(() => {
    if (!open) return;
    const first = results.findIndex((r) => selectable(r.number));
    const current = value ? results.findIndex((r) => r.number === value) : -1;
    setHighlight(query ? Math.max(0, first) : Math.max(0, current >= 0 ? current : first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const choose = (n: number) => {
    if (!selectable(n)) return;
    onChange(n);
    setOpen(false);
    setQuery('');
  };

  const move = (step: number) => {
    if (results.length === 0) return;
    let i = highlight;
    for (let k = 0; k < results.length; k++) {
      i = (i + step + results.length) % results.length;
      if (selectable(results[i].number)) break;
    }
    setHighlight(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[highlight];
      if (r) choose(r.number);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const selected = value ? ALL_QUARTERS[value - 1] : null;
  const accent =
    tone === 'from'
      ? { badge: 'bg-pink-100 text-pink-900 border-pink-200', ring: 'focus:ring-pink-500/30 focus:border-pink-500', active: 'bg-pink-50' }
      : { badge: 'bg-amber-100 text-amber-900 border-amber-200', ring: 'focus:ring-amber-500/30 focus:border-amber-500', active: 'bg-amber-50' };

  return (
    <div ref={rootRef} className="relative w-full">
      <label htmlFor={`${id}-button`} className="flex items-center gap-1.5 text-xs font-bold text-stone-700 mb-1">
        <span className={`px-1.5 py-0.5 rounded-md border text-[10px] ${accent.badge}`}>{tone === 'from' ? 'من' : 'إلى'}</span>
        <span>{label}</span>
      </label>
      <button
        id={`${id}-button`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-stone-50 text-right flex items-center justify-between gap-2 outline-hidden focus:ring-2 ${accent.ring}`}
      >
        {selected ? (
          <span className="min-w-0 truncate">
            <strong className="text-stone-900">الربع {selected.number}</strong>
            <span className="text-stone-500"> — {selected.surahName} — بداية: </span>
            <span className="font-quran text-stone-700">{quarterOpening(selected, 3)}</span>
          </span>
        ) : (
          <span className="text-stone-400">{placeholder}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] bg-white border border-stone-200 rounded-2xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-stone-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-stone-400 shrink-0" />
            <input
              id={`${id}-search`}
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              inputMode="search"
              autoComplete="off"
              placeholder="ابحثي برقم الربع أو اسم السورة أو بداية الآية"
              className="w-full px-1 py-1.5 text-xs outline-hidden bg-transparent"
              role="combobox"
              aria-controls={`${id}-list`}
              aria-expanded
            />
          </div>
          <ul id={`${id}-list`} ref={listRef} role="listbox" className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {results.length === 0 && <li className="px-3 py-3 text-xs text-stone-400 text-center">لا توجد نتائج</li>}
            {results.map((q, i) => {
              const disabled = !selectable(q.number);
              const isSelected = q.number === value;
              return (
                <li
                  key={q.number}
                  id={`${id}-option-${q.number}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={disabled}
                  onMouseEnter={() => !disabled && setHighlight(i)}
                  onClick={() => choose(q.number)}
                  className={`px-3 py-2 text-xs flex items-center gap-2 ${
                    disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  } ${i === highlight && !disabled ? accent.active : ''}`}
                >
                  <span className="w-4 shrink-0">{isSelected && <Check className="w-4 h-4 text-pink-600" />}</span>
                  <span className="min-w-0">
                    <span className="font-bold text-stone-900">الربع {q.number}</span>
                    <span className="text-stone-500"> — {q.surahName} — بداية: </span>
                    <span className="font-quran text-stone-700">{quarterOpening(q)}</span>
                    <span className="block text-[10px] text-stone-400">
                      الجزء {q.juz} • الحزب {q.hizb} • الصفحة {q.page} • الآية {q.ayahStart}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
