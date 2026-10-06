-- Quotes, and the role the app connects as.
-- Superusers and table owners skip row level security, so the app must never connect as "superuser".
-- "superuser" runs these scripts, so it owns every table and "financing" owns none.

create role financing with login password 'financing' nosuperuser nobypassrls;
grant usage on schema public to financing;
grant select, insert, update, delete on "user", "session", "account", "verification" to financing;

-- Money: whole cents only, from 0 to 1,200,000,000
-- NOTE: Limit based on biggest system price being 1,200,000 (1000 kW x PRICE_PER_KW 1200 in lib/quote.ts). so 1000x, leaves room for price changes
create domain amount as numeric(12, 2) check (value between 0 and 1200000000);

-- Who is asking. data/quote-store.ts sets it for one transaction. Unset means nobody, so no rows.
create function app_user_id() returns text language sql stable as $$
	select nullif(current_setting('app.user_id', true), '')
$$;

-- The role column is copied from Keycloak on every sign in (lib/auth.ts)
alter table "user" add constraint user_role_check check (role in ('user', 'admin'));

create function app_is_admin() returns boolean language sql stable as $$
	select exists (select 1 from "user" where id = app_user_id() and role = 'admin')
$$;

-- A quote is a record of what was offered, so rows are never updated or deleted
create table quote (
	id uuid primary key default uuidv7(),
	user_id text not null default app_user_id() references "user" (id),
	address text not null check (length(address) between 1 and 500),
	monthly_consumption_kwh numeric(8, 2) not null check (monthly_consumption_kwh > 0 and monthly_consumption_kwh <= 100000),
	system_size_kw numeric(6, 2) not null check (system_size_kw between 1 and 1000),
	down_payment amount not null,
	system_price amount not null,
	principal amount not null,
	-- NOTE: A number, not a letter, so new bands need no data migration. data/quote-store.ts maps letters to numbers.
	band smallint not null check (band between 0 and 99),
	created_at timestamptz not null default now(),
	constraint quote_principal_check check (principal > 0 and principal = system_price - down_payment)
);

create index quote_user_id_created_at_idx on quote (user_id, created_at desc);

create table quote_offer (
	quote_id uuid not null references quote (id),
	term_years integer not null check (term_years > 0),
	apr numeric(5, 2) not null check (apr > 0 and apr < 100),
	monthly_payment amount not null,
	primary key (quote_id, term_years)
);

grant select, insert on quote, quote_offer to financing;

-- Users see and add only their own quotes. Admins see all, but add only their own.
-- "(select ...)" runs the function once per query, not once per row.
alter table quote enable row level security;
alter table quote force row level security;
create policy quote_read on quote for select using (user_id = (select app_user_id()) or (select app_is_admin()));
create policy quote_add on quote for insert with check (user_id = (select app_user_id()));

-- The subquery on quote runs under quote's own policies, so an offer is visible exactly when its quote is
alter table quote_offer enable row level security;
alter table quote_offer force row level security;
create policy quote_offer_read on quote_offer for select using (exists (select 1 from quote where quote.id = quote_id));
create policy quote_offer_add on quote_offer for insert with check (
	exists (select 1 from quote where quote.id = quote_id and quote.user_id = (select app_user_id()))
);
