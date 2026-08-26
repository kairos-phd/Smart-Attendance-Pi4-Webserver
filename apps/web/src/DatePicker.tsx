import { useEffect, useMemo, useRef, useState } from 'react';
import { translations, type Language } from './i18n';
import './date-picker.css';

type DatePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  defaultViewYear?: number;
  yearStart: number;
  yearEnd: number;
  showToday?: boolean;
  language: Language;
};

function parts(value: string, fallbackYear: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? { year: Number(match[1]), month: Number(match[2]) - 1 }
    : { year: fallbackYear, month: new Date().getMonth() };
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function displayDate(value: string, locale: string, emptyLabel: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return emptyLabel;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DatePicker({ label, value, onChange, min, max, defaultViewYear = new Date().getFullYear(), yearStart, yearEnd, showToday = true, language }: DatePickerProps) {
  const copy = translations[language];
  const initial = parts(value, defaultViewYear);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);
  const root = useRef<HTMLDivElement>(null);
  const years = useMemo(() => Array.from({ length: yearEnd - yearStart + 1 }, (_, index) => yearEnd - index), [yearStart, yearEnd]);
  const monthNames = useMemo(() => Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(copy.locale, { month: 'long' }).format(new Date(2024, month, 1))), [copy.locale]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, day) => new Intl.DateTimeFormat(copy.locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + day))), [copy.locale]);
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const dayCount = new Date(viewYear, viewMonth + 1, 0).getDate();

  useEffect(() => {
    if (!value) return;
    const selected = parts(value, defaultViewYear);
    setViewYear(selected.year);
    setViewMonth(selected.month);
  }, [value, defaultViewYear]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function moveMonth(amount: number) {
    const next = new Date(viewYear, viewMonth + amount, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  return <div className="date-picker-field" ref={root}>
    <span className="date-picker-label">{label}</span>
    <button type="button" className={value ? 'date-picker-trigger selected' : 'date-picker-trigger'} onClick={() => setOpen(current => !current)} aria-expanded={open} aria-haspopup="dialog">
      <span>{displayDate(value, copy.locale, copy.datePicker.select)}</span><span className="date-picker-icon" aria-hidden="true">▦</span>
    </button>
    {open && <div className="date-picker-popover" role="dialog" aria-label={`${copy.datePicker.choose}: ${label.toLowerCase()}`}>
      <div className="date-picker-nav">
        <button type="button" onClick={() => moveMonth(-1)} aria-label={copy.datePicker.previous}>‹</button>
        <div className="date-picker-selects">
          <select value={viewMonth} onChange={event => setViewMonth(Number(event.target.value))} aria-label={copy.datePicker.month}>
            {monthNames.map((month, index) => <option value={index} key={month}>{month}</option>)}
          </select>
          <select value={viewYear} onChange={event => setViewYear(Number(event.target.value))} aria-label={copy.datePicker.year}>
            {years.map(year => <option value={year} key={year}>{year}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => moveMonth(1)} aria-label={copy.datePicker.next}>›</button>
      </div>
      <div className="date-picker-weekdays">{weekDays.map(day => <span key={day}>{day}</span>)}</div>
      <div className="date-picker-days">
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1;
          const candidate = isoDate(viewYear, viewMonth, day);
          const disabled = Boolean((min && candidate < min) || (max && candidate > max));
          return <button type="button" key={candidate} disabled={disabled} className={candidate === value ? 'active' : ''} onClick={() => { onChange(candidate); setOpen(false); }}>{day}</button>;
        })}
      </div>
      {(value || showToday) && <div className="date-picker-footer">
        {value && <button type="button" className="date-picker-clear" onClick={() => onChange('')}>{copy.datePicker.clear}</button>}
        {showToday && <button type="button" className="date-picker-today" onClick={() => { const current = new Date(); const candidate = isoDate(current.getFullYear(), current.getMonth(), current.getDate()); if ((!min || candidate >= min) && (!max || candidate <= max)) { onChange(candidate); setOpen(false); } }}>{copy.datePicker.today}</button>}
      </div>}
    </div>}
  </div>;
}
