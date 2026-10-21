// Run with Node 22 and an installed @electric-sql/pglite module:
// node scripts/check-cash-allocation-rls.mjs /path/to/pglite/dist/index.js
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const user = "10000000-0000-0000-0000-000000000001";
const acctA = "20000000-0000-0000-0000-000000000001";
const acctB = "20000000-0000-0000-0000-000000000002";
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  create table households(id uuid primary key);
  create table household_members(household_id uuid, user_id uuid);
  grant select on household_members to authenticated;
  create table accounts(id uuid primary key, household_id uuid references households(id));
  insert into households values ('${a}'), ('${b}');
  insert into household_members values ('${a}', '${user}');
  insert into accounts values ('${acctA}', '${a}'), ('${acctB}', '${b}');`);
await db.exec(readFileSync(new URL("../supabase/migrations/20261010075000_cash_allocations.sql", import.meta.url), "utf8"));
await db.exec(`insert into cash_allocations(household_id, account_id) values ('${a}','${acctA}'),('${b}','${acctB}');
  set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
assert.equal((await db.query("select * from cash_allocations")).rows.length, 1);
await db.exec(`update cash_allocations set pots='[{"label":"Tax","amount":123.45}]', revision=revision+1 where household_id='${a}';`);
assert.equal((await db.query("select pots from cash_allocations")).rows[0].pots[0].amount, 123.45);
// A stale revision cannot replace the updated row, and another household is invisible.
assert.equal((await db.query(`update cash_allocations set pots='[]' where revision=1 returning *`)).rows.length, 0);
assert.equal((await db.query(`update cash_allocations set pots='[]' where household_id='${b}' returning *`)).rows.length, 0);
assert.equal((await db.query(`delete from cash_allocations where household_id='${b}' returning *`)).rows.length, 0);
await assert.rejects(db.query(`insert into cash_allocations(household_id,account_id) values ('${b}','${acctA}')`), (e) => e.code === "42501");
await assert.rejects(db.query(`update cash_allocations set household_id='${b}',account_id='${acctB}'`), (e) => e.code === "42501");
for (const pots of ['[{"label":"Tax","amount":-1}]', '[{"label":"Tax","amount":0.001}]', '[{"label":"","amount":1}]', '[{"label":"Tax","amount":"oops"}]', '[{"label":"Tax"}]', '{}']) {
  await assert.rejects(db.query("update cash_allocations set pots=$1", [pots]));
}
await assert.rejects(db.query(`update cash_allocations set whole_account_label='Tax'`), (e) => e.code === "23514");
await db.exec("reset role; set role anon;");
for (const query of ["select * from cash_allocations", "update cash_allocations set pots='[]'", "delete from cash_allocations"]) {
  await assert.rejects(db.query(query), (e) => e.code === "42501");
}
await db.exec(`reset role; set role service_role;`);
await assert.rejects(db.query(`update cash_allocations set account_id='${acctB}' where household_id='${a}'`), (e) => e.code === "23503");
assert.equal((await db.query("select * from cash_allocations")).rows.length, 2);
await db.exec(`set role authenticated; delete from cash_allocations where household_id='${a}';
  insert into cash_allocations(household_id,account_id,business_cash) values ('${a}','${acctA}',true);`);
assert.equal((await db.query("select * from cash_allocations")).rows.length, 1);
await db.close();
console.log("Migration replay, money validation, member CRUD, household isolation, anonymous denial, foreign-key isolation and stale-revision protection passed.");
