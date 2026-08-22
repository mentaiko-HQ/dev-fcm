'use client';

import React, { useState, useMemo } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import {
  Participant,
  ParticipantStatus,
  DivisionType,
} from '@/types/participant';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Search, RefreshCcw } from 'lucide-react';

// 初期マスターデータ（大会運用時はFirestoreのentries/teamsコレクションから購読・同期）
const INITIAL_PARTICIPANTS: Participant[] = [
  {
    id: 'p1',
    standNumber: 1,
    position: '大前',
    teamId: 't1',
    teamName: '福岡弓道倶楽部A',
    playerName: '佐藤 健一',
    division: '一般男子',
    status: '行射中',
    totalHits: 3,
    totalShots: 4,
  },
  {
    id: 'p2',
    standNumber: 1,
    position: '中',
    teamId: 't1',
    teamName: '福岡弓道倶楽部A',
    playerName: '鈴木 隆',
    division: '一般男子',
    status: '行射中',
    totalHits: 4,
    totalShots: 4,
  },
  {
    id: 'p3',
    standNumber: 1,
    position: '落',
    teamId: 't1',
    teamName: '福岡弓道倶楽部A',
    playerName: '高橋 誠',
    division: '一般男子',
    status: '行射中',
    totalHits: 2,
    totalShots: 4,
  },
  {
    id: 'p4',
    standNumber: 2,
    position: '大前',
    teamId: 't2',
    teamName: '博多紅葉会',
    playerName: '田中 美咲',
    division: '一般女子',
    status: '招集中',
    totalHits: 0,
    totalShots: 0,
  },
  {
    id: 'p5',
    standNumber: 2,
    position: '中',
    teamId: 't2',
    teamName: '博多紅葉会',
    playerName: '渡辺 彩花',
    division: '一般女子',
    status: '招集中',
    totalHits: 0,
    totalShots: 0,
  },
  {
    id: 'p6',
    standNumber: 2,
    position: '落',
    teamId: 't2',
    teamName: '博多紅葉会',
    playerName: '小林 葵',
    division: '一般女子',
    status: '招集中',
    totalHits: 0,
    totalShots: 0,
  },
  {
    id: 'p7',
    standNumber: 3,
    position: '大前',
    teamId: 't3',
    teamName: '春日白鷺会',
    playerName: '伊藤 剛',
    division: 'シニア男子',
    status: '待機中',
    totalHits: 0,
    totalShots: 0,
  },
  {
    id: 'p8',
    standNumber: 3,
    position: '落',
    teamId: 't3',
    teamName: '春日白鷺会',
    playerName: '山本 翔太',
    division: 'シニア男子',
    status: '待機中',
    totalHits: 0,
    totalShots: 0,
  },
  {
    id: 'p9',
    standNumber: 4,
    position: '大前',
    teamId: 't4',
    teamName: '筑紫野葵会',
    playerName: '中村 陽子',
    division: 'シニア女子',
    status: '待機中',
    totalHits: 0,
    totalShots: 0,
  },
];

export function ParticipantDataTable() {
  const [data] = useState<Participant[]>(INITIAL_PARTICIPANTS);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'standNumber', desc: false },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState<string>('');
  const [selectedDivision, setSelectedDivision] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // ステータスバッジのスタイル設定（UI/UX: 視認性の最大化）
  const getStatusBadge = (status: ParticipantStatus) => {
    switch (status) {
      case '行射中':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 animate-pulse">
            行射中
          </span>
        );
      case '招集中':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
            招集中
          </span>
        );
      case '待機中':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
            待機中
          </span>
        );
      case '競技終了':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            終了
          </span>
        );
      case '棄権':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
            棄権
          </span>
        );
      default:
        return <span className="text-xs text-slate-500">-</span>;
    }
  };

  // カラム定義（フールプルーフ: ColumnDef型による厳格な型推論）
  const columns = useMemo<ColumnDef<Participant>[]>(
    () => [
      {
        accessorKey: 'standNumber',
        header: ({ column }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="h-8 px-2 text-xs font-bold"
          >
            立順
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="font-bold text-slate-900 text-center w-12">
            第 {row.getValue<number>('standNumber')} 立
          </div>
        ),
      },
      {
        accessorKey: 'position',
        header: '位置',
        cell: ({ row }) => (
          <span className="text-xs font-medium text-slate-600">
            {row.getValue<string>('position')}
          </span>
        ),
      },
      {
        accessorKey: 'teamName',
        header: ({ column }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="h-8 px-2 text-xs font-bold"
          >
            所属チーム
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="font-semibold text-slate-800">
            {row.getValue<string>('teamName')}
          </div>
        ),
      },
      {
        accessorKey: 'playerName',
        header: '選手氏名',
        cell: ({ row }) => (
          <div className="font-medium text-slate-900">
            {row.getValue<string>('playerName')}
          </div>
        ),
      },
      {
        accessorKey: 'division',
        header: '部門',
        cell: ({ row }) => (
          <span className="text-xs text-slate-500">
            {row.getValue<DivisionType>('division')}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: '状態',
        cell: ({ row }) =>
          getStatusBadge(row.getValue<ParticipantStatus>('status')),
      },
      {
        accessorKey: 'totalHits',
        header: ({ column }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="h-8 px-2 text-xs font-bold"
          >
            的中
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const hits = row.getValue<number>('totalHits');
          const shots = row.original.totalShots;
          return (
            <div className="text-right font-bold pr-2">
              <span className="text-red-600">{hits}</span>
              <span className="text-slate-400 text-xs">
                {' '}
                / {shots > 0 ? shots : '-'}
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );

  // 複合フィルタリング処理（フェイルセーフ: 未定義値・空文字に対する安全なフォールバック）
  const filteredData = useMemo(() => {
    return data.filter((item: Participant) => {
      // 部門絞り込み
      if (selectedDivision !== 'ALL' && item.division !== selectedDivision) {
        return false;
      }
      // ステータス絞り込み
      if (selectedStatus !== 'ALL' && item.status !== selectedStatus) {
        return false;
      }
      // キーワード検索（選手名・チーム名）
      if (globalFilter.trim().length > 0) {
        const query = globalFilter.toLowerCase();
        const matchesPlayer = (item.playerName || '')
          .toLowerCase()
          .includes(query);
        const matchesTeam = (item.teamName || '').toLowerCase().includes(query);
        if (!matchesPlayer && !matchesTeam) {
          return false;
        }
      }
      return true;
    });
  }, [data, selectedDivision, selectedStatus, globalFilter]);

  // TanStack Table v8 インスタンス生成
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  // フィルター初期化ハンドラ
  const handleResetFilters = () => {
    setGlobalFilter('');
    setSelectedDivision('ALL');
    setSelectedStatus('ALL');
    setSorting([{ id: 'standNumber', desc: false }]);
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-4">
      {/* フィルタリング・検索ツールバー */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="選手名・チーム名で検索..."
            value={globalFilter}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setGlobalFilter(e.target.value)
            }
            className="pl-9 pr-4 py-2 w-full text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* 部門絞り込み */}
          <select
            value={selectedDivision}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedDivision(e.target.value)
            }
            className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          >
            <option value="ALL">全部門</option>
            <option value="一般男子">一般男子</option>
            <option value="一般女子">一般女子</option>
            <option value="シニア男子">シニア男子</option>
            <option value="シニア女子">シニア女子</option>
          </select>

          {/* ステータス絞り込み */}
          <select
            value={selectedStatus}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedStatus(e.target.value)
            }
            className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          >
            <option value="ALL">全ステータス</option>
            <option value="待機中">待機中</option>
            <option value="招集中">招集中</option>
            <option value="行射中">行射中</option>
            <option value="競技終了">競技終了</option>
            <option value="棄権">棄権</option>
          </select>

          {/* フィルターリセットボタン */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetFilters}
            className="h-9 px-3"
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            リセット
          </Button>
        </div>
      </div>

      {/* データテーブル */}
      <div className="rounded-md border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-slate-500"
                >
                  該当する参加者・立が見つかりません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ページネーションおよび件数表示 */}
      <div className="flex items-center justify-between text-xs text-slate-600 px-1">
        <div>
          全{' '}
          <span className="font-semibold text-slate-900">
            {filteredData.length}
          </span>{' '}
          件中{' '}
          {filteredData.length > 0
            ? table.getState().pagination.pageIndex *
                table.getState().pagination.pageSize +
              1
            : 0}{' '}
          -{' '}
          {Math.min(
            (table.getState().pagination.pageIndex + 1) *
              table.getState().pagination.pageSize,
            filteredData.length,
          )}{' '}
          件を表示
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 px-2 text-xs"
          >
            前へ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 px-2 text-xs"
          >
            次へ
          </Button>
        </div>
      </div>
    </div>
  );
}
