import type { Key, ReactNode } from 'react'
export interface TableColumn<T> { key: string; header: string; render: (row: T) => ReactNode }
export function DataTable<T>({ rows, columns, rowKey, caption }: { rows: T[]; columns: TableColumn<T>[]; rowKey: (row: T) => Key; caption: string }) {
  return <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
    <table><caption className="sr-only">{caption}</caption>
      <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>
}
