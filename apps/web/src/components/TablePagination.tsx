import { useState } from 'react';
import { latestFirst, pageForRows, paginate } from './tablePagination';
export function useTablePagination<T>(rows: T[], id: (row: T) => string, time?: (row: T) => number, filterKey = '') {
  const ordered = time ? latestFirst(rows, time) : rows;
  const key = JSON.stringify([filterKey, ordered.map(id)]);
  const [size, setSize] = useState(10);
  const [position, setPosition] = useState({ key, page: 0 });
  const result = paginate(ordered, size, pageForRows(position.key, key, position.page));
  return { ...result, total: rows.length, size,
    setPage: (page: number) => setPosition({ key, page }),
    setSize: (next: number) => { setSize(next); setPosition({ key, page: 0 }); } };
}
export function TablePagination({ pagination: p, locale }: { pagination: ReturnType<typeof useTablePagination>; locale: string }) {
  const vi = locale.startsWith('vi');
  const first = p.total ? p.page * p.size + 1 : 0;
  return <nav className="table-pagination" aria-label={vi ? 'Phân trang bảng' : 'Table pagination'}>
    <label>{vi ? 'Số dòng mỗi trang' : 'Rows per page'}<select value={p.size} onChange={event => p.setSize(Number(event.target.value))}>{[10,20,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
    <span role="status">{first}–{Math.min((p.page + 1) * p.size, p.total)} / {p.total}</span>
    <div><button className="secondary" disabled={p.page === 0} onClick={() => p.setPage(p.page - 1)}>{vi ? 'Mới hơn' : 'Newer'}</button><button className="secondary" disabled={p.page + 1 >= p.pages} onClick={() => p.setPage(p.page + 1)}>{vi ? 'Cũ hơn' : 'Older'}</button></div>
  </nav>;
}
