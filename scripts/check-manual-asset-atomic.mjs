// node scripts/check-manual-asset-atomic.mjs /path/to/pglite/dist/index.js
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
  grant usage on schema public, auth to authenticated, service_role;
  grant execute on function auth.uid() to authenticated;`);
for (const file of ['0001_households.sql', '0002_accounts_transactions.sql',
  '0006_accounts_write_policies.sql', '0009_accounts_enrichment.sql',
  '0044_amortising_liabilities.sql', '0045_expected_inflows.sql',
  '0047_manual_asset_member_write_policies.sql', '20261021080050_save_manual_asset_atomic.sql']) {
  await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
}
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const user = '10000000-0000-4000-8000-000000000001';
await db.exec(`insert into households(id,name) values ('${a}','A'),('${b}','B');
  insert into household_members(household_id,user_id,role)
    select '${a}',id,'member' from auth.users where false;
  alter table household_members drop constraint household_members_user_id_fkey;
  insert into household_members(household_id,user_id,role) values ('${a}','${user}','member');
  grant select,insert,update,delete on all tables in schema public to authenticated, service_role;`);
const category = (await db.query(`select id from categories where household_id='${a}'`)).rows[0].id;
const asset = {akahu_account_id:'manual_test',name:'Test',institution:'Manual',type:'other',currency:'NZD',balance_current:-100};
const save = (hh, value, create, loan=null, inflow=null) => db.query(
  'select public.save_manual_asset($1,$2,$3,$4,$5) as saved', [hh,value,create,loan,inflow]);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
await save(a,asset,true);
const original = (await db.query('select balance_current from accounts')).rows[0].balance_current;
// Fail the child write AFTER the account update. The entire statement rolls back.
await assert.rejects(save(a,{...asset,balance_current:-500},false,{
  repayment_category_id:category,anchor_balance:500,annual_rate:0,anchor_date:'invalid-date'
}));
assert.equal((await db.query('select balance_current from accounts')).rows[0].balance_current,original);
await assert.rejects(save(a,{...asset,akahu_account_id:'manual_new'},true,null,{
  likelihood:'invalid',expected_date:null,pre_tax:false,tax_rate:0
}));
assert.equal((await db.query('select count(*)::int as n from accounts')).rows[0].n,1);
const result = await save(a,asset,false,{
  repayment_category_id:category,anchor_balance:100,annual_rate:0,anchor_date:'2026-01-01'
});
assert.equal(result.rows[0].saved.loan.anchor_balance,100);
await assert.rejects(save(b,{...asset,akahu_account_id:'manual_foreign'},true));
await db.exec('reset role; set role anon;');
await assert.rejects(save(a,asset,false));
await db.exec('reset role; set role service_role;');
await assert.rejects(save(b,asset,false));
await assert.rejects(save(a,asset,false,{repayment_category_id:'00000000-0000-4000-8000-000000000099',anchor_balance:100,annual_rate:0,anchor_date:'2026-01-01'}));
assert.equal((await db.query('select count(*)::int as n from amortising_liabilities')).rows[0].n,1);
await db.close();
console.log('Manual asset rollback, successful loan save, member isolation and anonymous denial passed.');
