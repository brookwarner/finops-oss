import { expect, it, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any, fetched: [] as any[], calls: [] as any[], mode: '', failWrite: false, failFetch: false }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: () => state.db }));
vi.mock('@/lib/akahu/client', () => ({ buildAkahuClientFromEnv: () => ({ transactions: {
  list: async () => { if (state.failFetch) throw new Error('fetch failed'); return { items: state.fetched, cursor: {} }; }, listPending: async () => []
} }) }));
vi.mock('@/lib/akahu/config', () => ({ getAkahuUserToken: async () => 'token' }));
vi.mock('@/lib/budgets/compute', () => ({ computeBudgets: async () => ({}) }));
vi.mock('@/lib/budgets/snapshot', () => ({ snapshotRecordsFromResult: () => [], upsertSnapshots: async () => {} }));
vi.mock('@/lib/dedup/cross-source', () => ({ planDedupActions: () => [], applyDedupActions: async () => {}, isPocketSmithRow: () => false }));
vi.mock('@/lib/transfers/detect', () => ({ planTransferActions: () => [], applyTransferActions: async () => {} }));
import { runPollTransactions } from '@/lib/cron/poll-transactions';

beforeEach(() => {
  state.calls = [];
  state.fetched = [];
  state.mode = 'poll';
  state.failWrite = false;
  state.failFetch = false;
  state.db = { from(table: string) {
    const c: any = { table, op: 'select', filters: [] };
    const b: any = {};
    for (const name of ['select','update','insert','upsert','delete','eq','gte','lte','lt','is','in','order','limit','single','maybeSingle','range']) {
      b[name] = (...args: any[]) => {
        if (['update','insert','upsert','delete'].includes(name)) { c.op = name; c.payload = args[0]; }
        if (['eq','gte','lte','lt','is','in'].includes(name)) c.filters.push([name,...args]);
        return b;
      };
    }
    b.then = (resolve: any, reject: any) => {
      state.calls.push(c);
      let result: any = { data: [], error: null };
      if (state.mode === 'poll') {
        if (table === 'accounts' && c.op === 'select') result.data = [{ id:'account', household_id:'household', akahu_account_id:'acc_1', attributes:['TRANSACTIONS'] }];
        if (table === 'transactions' && c.op === 'upsert' && state.failWrite) result.error = { message:'write failed' };
        if (table === 'transactions' && c.op === 'delete') result.data = [{ id:'previously-manual-transaction' }];
      }
      return Promise.resolve(result).then(resolve, reject);
    };
    return b;
  } };
});

it('preserves existing transactions when their refresh write fails', async () => {
  state.mode = 'poll';
  state.failWrite = true;
  state.fetched = [{ _id:'tx_1', _account:'acc_1', date:new Date().toISOString(), amount:-100, type:'DEBIT', description:'Coffee' }];
  const result = await (await runPollTransactions()).json();
  expect(result.errors.some((e: any) => e.scope === 'upsert_posted')).toBe(true);
  expect(result.deleted).toBe(0);
  expect(state.calls.some(c => c.table === 'transactions' && c.op === 'delete')).toBe(false);
});

it('reconciles bank deletions even when no transactions remain in the window', async () => {
  state.mode = 'poll';
  await runPollTransactions();
  expect(state.calls.some(c => c.table === 'transactions' && c.op === 'delete')).toBe(true);
});


it('never deletes transactions after an incomplete bank fetch', async () => {
  state.failFetch = true;
  await runPollTransactions();
  expect(state.calls.some(c => c.table === 'transactions' && c.op === 'delete')).toBe(false);
});
