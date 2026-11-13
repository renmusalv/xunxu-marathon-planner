-- Run once in a dedicated Supabase project's SQL editor, or with `supabase db push`.
-- Storage bucket creation/deletion belongs to the Storage API, not SQL.
-- Public RPCs intentionally use SECURITY DEFINER: table writes are revoked and
-- every entry point derives the owner from verified Supabase Auth, never input.
begin;

create schema if not exists xunxu_private;
revoke all on schema xunxu_private from public, anon, authenticated;

create table public.xunxu_profiles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  name text not null check (char_length(name) between 1 and 48),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1048576),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create index xunxu_profiles_owner_updated on public.xunxu_profiles(owner_id, updated_at desc);
alter table public.xunxu_profiles enable row level security;
revoke all on public.xunxu_profiles from public, anon, authenticated;
grant select on public.xunxu_profiles to authenticated;

create table xunxu_private.image_uploads (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  record_id text not null check (record_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  object_key text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 12582912),
  expected_revision bigint not null check (expected_revision >= 1),
  state text not null default 'pending' check (state in ('pending', 'attached', 'retired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cleanup_after timestamptz,
  cleanup_lease_until timestamptz,
  cleanup_attempts integer not null default 0,
  cleaned_at timestamptz,
  foreign key (owner_id, profile_id) references public.xunxu_profiles(owner_id, id) on delete cascade
);
create unique index xunxu_one_attached_image on xunxu_private.image_uploads(owner_id, profile_id, record_id) where state = 'attached';
create index xunxu_image_cleanup on xunxu_private.image_uploads(owner_id, state, cleanup_after);
alter table xunxu_private.image_uploads enable row level security;
revoke all on xunxu_private.image_uploads from public, anon, authenticated;

create function xunxu_private.fail(p_state text, p_code text, p_message text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = p_state, message = p_message,
    detail = (jsonb_build_object('code', p_code) || p_extra)::text;
end;
$$;

create function xunxu_private.verified_uid()
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where u.id = (select auth.uid())
    and coalesce(u.is_anonymous, false) = false
    and coalesce((select auth.jwt())->>'is_anonymous', 'false') = 'false'
    and u.email_confirmed_at is not null
    and nullif(btrim(u.email), '') is not null
$$;

create function xunxu_private.require_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.verified_uid();
begin
  if v_actor is null then
    perform xunxu_private.fail('PT401', 'AUTH_REQUIRED', '请先登录，再保存云端档案。');
  end if;
  return v_actor;
end;
$$;

create policy xunxu_profiles_select_own on public.xunxu_profiles for select to authenticated
  using (owner_id = (select xunxu_private.verified_uid()));

create function xunxu_private.valid_id(p_value text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_value ~ '^[A-Za-z0-9_-]{1,100}$'
    and p_value not in ('__proto__', 'prototype', 'constructor'), false)
$$;

create function xunxu_private.only_keys(p_value jsonb, p_keys text[])
returns boolean language sql immutable set search_path = '' as $$
  select not exists (select 1 from jsonb_object_keys(p_value) k where not (k = any(p_keys)))
$$;

create function xunxu_private.valid_date(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_date date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  v_date := p_value::date;
  return v_date between date '1900-01-01' and date '2200-12-31'
    and to_char(v_date, 'YYYY-MM-DD') = p_value;
exception when others then return false;
end;
$$;

create function xunxu_private.valid_plan_key(p_value text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(char_length(p_value) between 1 and 300 and p_value ~ '^[A-Za-z0-9_.:-]+$'
    and p_value not in ('__proto__', 'prototype', 'constructor'), false)
$$;

-- The form is a draft: incomplete strings are allowed. Confirmed records and
-- check-ins have stricter validation. Image flags are always reconstructed.
create function xunxu_private.normalise_data(p_data jsonb, p_profile_id text, p_image_ids text[] default '{}'::text[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_form jsonb; v_records jsonb; v_plans jsonb; v_history jsonb;
  v_out_records jsonb := '[]'; v_out_plans jsonb := '{}'; v_out_history jsonb := '[]';
  v_rec jsonb; v_item jsonb; v_pair record; v_check record; v_date_item jsonb;
  v_checks jsonb; v_dates jsonb; v_started text; v_date text; v_id text; v_key text;
  v_dist numeric; v_seconds numeric; v_avg numeric; v_peak numeric; v_confidence numeric;
  v_ids text[] := '{}'; v_fingerprints text[] := '{}'; v_history_keys text[] := '{}';
  v_fingerprint text; v_result jsonb;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    perform xunxu_private.fail('PT400', 'INVALID_DATA', '档案内容必须是对象。');
  end if;
  if octet_length(p_data::text) > 1048576 then
    perform xunxu_private.fail('PT413', 'DATA_TOO_LARGE', '单个档案最多保存 1 MiB 数据。');
  end if;
  if not xunxu_private.only_keys(p_data, array['form','records','plans','history']) then
    perform xunxu_private.fail('PT400', 'INVALID_DATA', '档案含有不支持的字段。');
  end if;
  v_form := coalesce(p_data->'form', '{}'::jsonb);
  v_records := coalesce(p_data->'records', '[]'::jsonb);
  v_plans := coalesce(p_data->'plans', '{}'::jsonb);
  v_history := coalesce(p_data->'history', '[]'::jsonb);
  if jsonb_typeof(v_form) <> 'object' or jsonb_typeof(v_records) <> 'array'
    or jsonb_typeof(v_plans) <> 'object' or jsonb_typeof(v_history) <> 'array' then
    perform xunxu_private.fail('PT400', 'INVALID_DATA', '档案字段格式不正确。');
  end if;
  if not xunxu_private.only_keys(v_form, array[
    'distance','raceDate','halfGoalTime','paceMin','paceSec','weeklyKm','days','longRun',
    'benchmarkDistance','benchmarkTime','benchmarkDate','age','restingHr','maxHr',
    'maxHrSource','thresholdHr','thresholdHrSource','vo2max','vo2maxSource','vo2maxDate',
    'experienceMonths','recentConsistency','discomfort']) then
    perform xunxu_private.fail('PT400', 'INVALID_FORM', '用户资料含有不支持的字段。');
  end if;
  for v_pair in select key, value from jsonb_each(v_form) loop
    if jsonb_typeof(v_pair.value) <> 'string' or char_length(v_pair.value #>> '{}') > 120 then
      perform xunxu_private.fail('PT400', 'INVALID_FORM', '用户资料应为不超过 120 字的文本。');
    end if;
  end loop;
  if jsonb_array_length(v_records) > 100 then
    perform xunxu_private.fail('PT413', 'RECORD_LIMIT', '每个档案最多保存 100 条成绩。');
  end if;
  for v_rec in select value from jsonb_array_elements(v_records) loop
    if jsonb_typeof(v_rec) <> 'object' then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '成绩格式不正确。');
    end if;
    if not xunxu_private.only_keys(v_rec, array['id','profileId','distanceKm','elapsedSeconds','date',
      'averageHr','peakHr','effort','confirmed','include','durationType','course','source','filename',
      'rawText','fingerprint','recognitionConfidence','hasImage','updatedAt']) then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '成绩含有不支持的字段；图片须通过私有上传流程保存。');
    end if;
    v_id := v_rec->>'id';
    if not xunxu_private.valid_id(v_id) or v_id = any(v_ids) then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD_ID', '成绩编号无效或重复。');
    end if;
    v_ids := array_append(v_ids, v_id);
    if v_rec ? 'profileId' and (jsonb_typeof(v_rec->'profileId') <> 'string' or v_rec->>'profileId' <> p_profile_id) then
      perform xunxu_private.fail('PT400', 'PROFILE_MISMATCH', '成绩归属与当前档案不一致。');
    end if;
    if jsonb_typeof(v_rec->'distanceKm') is distinct from 'number'
      or jsonb_typeof(v_rec->'elapsedSeconds') is distinct from 'number' then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '成绩距离和用时必须是数值。');
    end if;
    v_dist := (v_rec->>'distanceKm')::numeric;
    v_seconds := (v_rec->>'elapsedSeconds')::numeric;
    if v_dist not in (10, 21.0975, 42.195) or v_seconds <> trunc(v_seconds)
      or v_seconds < v_dist * 120 or v_seconds > v_dist * 1200 then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '请核对成绩距离和实际用时。');
    end if;
    v_date := v_rec->>'date';
    if jsonb_typeof(v_rec->'date') is distinct from 'string' or not xunxu_private.valid_date(v_date) then
      perform xunxu_private.fail('PT400', 'INVALID_DATE', '请填写真实的成绩日期。');
    end if;
    if v_date::date > v_today + 1 then
      perform xunxu_private.fail('PT400', 'FUTURE_RECORD', '成绩日期不能晚于当前日期。');
    end if;
    if exists (select 1 from jsonb_array_elements(v_out_records) r
      where r->>'date' = v_date and (r->>'distanceKm')::numeric = v_dist
        and (r->>'elapsedSeconds')::numeric = v_seconds) then
      perform xunxu_private.fail('PT409', 'DUPLICATE_RECORD', '本档案已保存同日期、距离和用时的成绩。');
    end if;
    v_avg := null; v_peak := null;
    if coalesce(v_rec->'averageHr', 'null') <> 'null'::jsonb then
      if jsonb_typeof(v_rec->'averageHr') <> 'number' then
        perform xunxu_private.fail('PT400', 'INVALID_HEART_RATE', '平均心率格式不正确。');
      end if;
      v_avg := (v_rec->>'averageHr')::numeric;
      if v_avg not between 30 and 240 then perform xunxu_private.fail('PT400', 'INVALID_HEART_RATE', '平均心率应为 30–240 bpm。'); end if;
    end if;
    if coalesce(v_rec->'peakHr', 'null') <> 'null'::jsonb then
      if jsonb_typeof(v_rec->'peakHr') <> 'number' then
        perform xunxu_private.fail('PT400', 'INVALID_HEART_RATE', '最高心率格式不正确。');
      end if;
      v_peak := (v_rec->>'peakHr')::numeric;
      if v_peak not between 30 and 250 then perform xunxu_private.fail('PT400', 'INVALID_HEART_RATE', '最高心率应为 30–250 bpm。'); end if;
    end if;
    if v_avg > v_peak then perform xunxu_private.fail('PT400', 'INVALID_HEART_RATE', '平均心率不能高于本次最高心率。'); end if;
    if coalesce(v_rec->>'effort', '') not in ('race','time_trial','training')
      or coalesce(v_rec->>'durationType', 'unknown') not in ('elapsed','moving','unknown')
      or coalesce(v_rec->>'course', 'unknown') not in ('road_flat','hilly','trail','treadmill','unknown')
      or coalesce(v_rec->>'source', 'manual') not in ('manual','screenshot') then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '请核对成绩类型、计时方式和赛道。');
    end if;
    if (v_rec ? 'confirmed' and jsonb_typeof(v_rec->'confirmed') <> 'boolean')
      or (v_rec ? 'include' and jsonb_typeof(v_rec->'include') <> 'boolean') then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '成绩确认字段必须为布尔值。');
    end if;
    if (v_rec ? 'filename' and (jsonb_typeof(v_rec->'filename') <> 'string' or char_length(v_rec->>'filename') > 160))
      or (v_rec ? 'rawText' and (jsonb_typeof(v_rec->'rawText') <> 'string' or char_length(v_rec->>'rawText') > 20000)) then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '截图名称或识别文本过长。');
    end if;
    v_fingerprint := v_rec->>'fingerprint';
    if v_fingerprint is not null then
      if v_fingerprint !~ '^[a-f0-9]{64}$' then perform xunxu_private.fail('PT400', 'INVALID_FINGERPRINT', '截图校验值格式不正确。'); end if;
      if v_fingerprint = any(v_fingerprints) then perform xunxu_private.fail('PT409', 'DUPLICATE_IMAGE', '本档案已保存这张截图。'); end if;
      v_fingerprints := array_append(v_fingerprints, v_fingerprint);
    end if;
    v_confidence := null;
    if coalesce(v_rec->'recognitionConfidence', 'null') <> 'null'::jsonb then
      if jsonb_typeof(v_rec->'recognitionConfidence') <> 'number' then
        perform xunxu_private.fail('PT400', 'INVALID_RECORD', '识别置信度格式不正确。');
      end if;
      v_confidence := (v_rec->>'recognitionConfidence')::numeric;
      if v_confidence not between 0 and 100 then perform xunxu_private.fail('PT400', 'INVALID_RECORD', '识别置信度应为 0–100。'); end if;
    end if;
    if v_rec ? 'updatedAt' and (jsonb_typeof(v_rec->'updatedAt') <> 'string'
      or char_length(v_rec->>'updatedAt') > 40 or (v_rec->>'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+Z-]{8,26}$') then
      perform xunxu_private.fail('PT400', 'INVALID_RECORD', '成绩修改时间格式不正确。');
    end if;
    v_item := jsonb_build_object('id',v_id,'profileId',p_profile_id,'distanceKm',v_dist,
      'elapsedSeconds',v_seconds,'date',v_date,'averageHr',v_avg,'peakHr',v_peak,
      'effort',v_rec->>'effort','confirmed',coalesce((v_rec->>'confirmed')::boolean,false),
      'include',coalesce((v_rec->>'include')::boolean,true),'durationType',coalesce(v_rec->>'durationType','unknown'),
      'course',coalesce(v_rec->>'course','unknown'),'source',coalesce(v_rec->>'source','manual'),
      'filename',coalesce(v_rec->>'filename',''),'rawText',coalesce(v_rec->>'rawText',''),
      'fingerprint',v_fingerprint,'recognitionConfidence',v_confidence,'hasImage',v_id = any(p_image_ids));
    if v_rec ? 'updatedAt' then v_item := v_item || jsonb_build_object('updatedAt',v_rec->>'updatedAt'); end if;
    v_out_records := v_out_records || jsonb_build_array(v_item);
  end loop;
  if (select count(*) from jsonb_object_keys(v_plans)) > 100 or jsonb_array_length(v_history) > 100 then
    perform xunxu_private.fail('PT413', 'PLAN_LIMIT', '每个档案最多保存 100 个训练计划。');
  end if;
  for v_pair in select key, value from jsonb_each(v_plans) loop
    if not xunxu_private.valid_plan_key(v_pair.key) or jsonb_typeof(v_pair.value) <> 'object' then
      perform xunxu_private.fail('PT400', 'INVALID_PLAN', '训练计划格式不正确。');
    end if;
    if not xunxu_private.only_keys(v_pair.value, array['started','checkins']) then
      perform xunxu_private.fail('PT400', 'INVALID_PLAN', '训练计划含有不支持的字段。');
    end if;
    v_started := coalesce(v_pair.value->>'started', '');
    if v_started <> '' and not xunxu_private.valid_date(v_started) then
      perform xunxu_private.fail('PT400', 'INVALID_DATE', '计划开始日期无效。');
    end if;
    v_checks := coalesce(v_pair.value->'checkins','{}'::jsonb);
    if jsonb_typeof(v_checks) <> 'object' then perform xunxu_private.fail('PT400','INVALID_PLAN','打卡记录格式不正确。'); end if;
    if (select count(*) from jsonb_object_keys(v_checks)) > 1000 then perform xunxu_private.fail('PT413','CHECKIN_LIMIT','单个计划的打卡记录过多。'); end if;
    v_item := '{}';
    for v_check in select key,value from jsonb_each(v_checks) loop
      if not xunxu_private.valid_date(v_check.key) or jsonb_typeof(v_check.value) <> 'boolean' then
        perform xunxu_private.fail('PT400','INVALID_CHECKIN','打卡日期或状态无效。');
      end if;
      if v_check.key::date > v_today + 1 then perform xunxu_private.fail('PT400','FUTURE_CHECKIN','尚未到达的训练日期不能打卡。'); end if;
      if v_check.value = 'true'::jsonb then v_item := v_item || jsonb_build_object(v_check.key,true); end if;
    end loop;
    v_out_plans := v_out_plans || jsonb_build_object(v_pair.key,jsonb_build_object('started',v_started,'checkins',v_item));
  end loop;
  for v_item in select value from jsonb_array_elements(v_history) loop
    if jsonb_typeof(v_item) <> 'object' then perform xunxu_private.fail('PT400','INVALID_HISTORY','计划历史格式不正确。'); end if;
    if not xunxu_private.only_keys(v_item,array['planKey','started','dates']) then perform xunxu_private.fail('PT400','INVALID_HISTORY','计划历史含有不支持的字段。'); end if;
    v_key := v_item->>'planKey';
    if not xunxu_private.valid_plan_key(v_key) or v_key = any(v_history_keys) then perform xunxu_private.fail('PT400','INVALID_HISTORY','计划历史编号无效或重复。'); end if;
    v_history_keys := array_append(v_history_keys,v_key);
    v_started := coalesce(v_item->>'started','');
    if v_started <> '' and not xunxu_private.valid_date(v_started) then perform xunxu_private.fail('PT400','INVALID_DATE','历史计划开始日期无效。'); end if;
    v_dates := coalesce(v_item->'dates','[]'::jsonb);
    if jsonb_typeof(v_dates) <> 'array' then perform xunxu_private.fail('PT400','INVALID_HISTORY','历史训练日期格式不正确。'); end if;
    if jsonb_array_length(v_dates) > 1000 then perform xunxu_private.fail('PT413','HISTORY_LIMIT','单个历史计划的日期过多。'); end if;
    for v_date_item in select value from jsonb_array_elements(v_dates) loop
      if jsonb_typeof(v_date_item) <> 'string' or not xunxu_private.valid_date(v_date_item #>> '{}') then
        perform xunxu_private.fail('PT400','INVALID_DATE','历史训练日期无效。');
      end if;
    end loop;
    select coalesce(jsonb_agg(d order by d),'[]'::jsonb) into v_dates
      from (select distinct value #>> '{}' as d from jsonb_array_elements(v_dates)) dates;
    v_out_history := v_out_history || jsonb_build_array(jsonb_build_object('planKey',v_key,'started',v_started,'dates',v_dates));
  end loop;
  v_result := jsonb_build_object('form',v_form,'records',v_out_records,'plans',v_out_plans,'history',v_out_history);
  if octet_length(v_result::text) > 1048576 then perform xunxu_private.fail('PT413','DATA_TOO_LARGE','单个档案最多保存 1 MiB 数据。'); end if;
  return v_result;
end;
$$;

create function xunxu_private.profile_json(p_profile public.xunxu_profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',p_profile.id,'name',p_profile.name,'data',p_profile.data,
    'revision',p_profile.revision,'updatedAt',to_char(p_profile.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

create function public.xunxu_list_profiles()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.require_actor(); v_profiles jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'revision',p.revision,
    'updatedAt',to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by p.created_at,p.id),'[]'::jsonb)
    into v_profiles from public.xunxu_profiles p where p.owner_id = v_actor;
  return jsonb_build_object('profiles',v_profiles);
end;
$$;

create function public.xunxu_get_profile(p_profile_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.require_actor(); v_profile public.xunxu_profiles;
begin
  select * into v_profile from public.xunxu_profiles where owner_id=v_actor and id=p_profile_id;
  if not found then perform xunxu_private.fail('PT404','PROFILE_NOT_FOUND','找不到当前账号的档案。'); end if;
  return jsonb_build_object('profile',xunxu_private.profile_json(v_profile));
end;
$$;

create function public.xunxu_create_profile(p_profile_id text, p_name text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.require_actor(); v_data jsonb; v_profile public.xunxu_profiles;
begin
  if not xunxu_private.valid_id(p_profile_id) then perform xunxu_private.fail('PT400','INVALID_PROFILE_ID','档案编号无效。'); end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 48 or p_name ~ '[[:cntrl:]]' then
    perform xunxu_private.fail('PT400','INVALID_NAME','档案名称应为 1–48 字。');
  end if;
  v_data := xunxu_private.normalise_data(p_data,p_profile_id);
  -- Serialize create/count for the same owner, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));
  if exists (select 1 from public.xunxu_profiles where owner_id=v_actor and id=p_profile_id) then
    perform xunxu_private.fail('PT409','PROFILE_EXISTS','当前账号已存在同编号档案。');
  end if;
  if (select count(*) from public.xunxu_profiles where owner_id=v_actor) >= 100 then
    perform xunxu_private.fail('PT413','PROFILE_LIMIT','每个账号最多保存 100 个档案。');
  end if;
  insert into public.xunxu_profiles(owner_id,id,name,data)
    values(v_actor,p_profile_id,btrim(p_name),v_data) returning * into v_profile;
  return jsonb_build_object('profile',xunxu_private.profile_json(v_profile));
end;
$$;

create function public.xunxu_prepare_image(p_profile_id text,p_record_id text,p_revision bigint,p_mime_type text,p_size_bytes bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := xunxu_private.require_actor(); v_profile public.xunxu_profiles;
  v_id uuid := gen_random_uuid(); v_key text; v_expires timestamptz; v_extension text;
begin
  if not xunxu_private.valid_id(p_record_id) then perform xunxu_private.fail('PT400','INVALID_RECORD_ID','成绩编号无效。'); end if;
  if p_mime_type is null or p_mime_type not in ('image/png','image/jpeg','image/webp') then
    perform xunxu_private.fail('PT400','INVALID_IMAGE_TYPE','截图仅支持 PNG、JPEG 或 WebP。');
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 12582912 then perform xunxu_private.fail('PT413','IMAGE_TOO_LARGE','截图不能超过 12 MiB。'); end if;
  if not exists (select 1 from storage.buckets where id='xunxu-results' and public=false) then
    perform xunxu_private.fail('PT503','STORAGE_NOT_READY','私有截图存储尚未配置，请联系项目管理员。');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,0));
  select * into v_profile from public.xunxu_profiles where owner_id=v_actor and id=p_profile_id for update;
  if not found then perform xunxu_private.fail('PT404','PROFILE_NOT_FOUND','找不到当前账号的档案。'); end if;
  if p_revision is distinct from v_profile.revision then
    perform xunxu_private.fail('PT409','REVISION_CONFLICT','云端档案已更新，请读取最新版本后再保存。',jsonb_build_object('currentRevision',v_profile.revision));
  end if;
  if (select count(*) from xunxu_private.image_uploads where owner_id=v_actor and state='pending' and expires_at>clock_timestamp()) >= 20 then
    perform xunxu_private.fail('PT429','UPLOAD_LIMIT','待处理截图过多，请稍后重试。');
  end if;
  v_extension := case p_mime_type when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  v_key := v_actor::text || '/' || p_profile_id || '/' || p_record_id || '/' || v_id::text || '.' || v_extension;
  v_expires := clock_timestamp() + interval '30 minutes';
  insert into xunxu_private.image_uploads(id,owner_id,profile_id,record_id,object_key,mime_type,size_bytes,expected_revision,expires_at)
    values(v_id,v_actor,p_profile_id,p_record_id,v_key,p_mime_type,p_size_bytes,p_revision,v_expires);
  return jsonb_build_object('uploadId',v_id,'bucket','xunxu-results','key',v_key,
    'expiresAt',to_char(v_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

create function public.xunxu_save_profile(p_profile_id text,p_revision bigint,p_data jsonb,p_name text default null,p_upload_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := xunxu_private.require_actor(); v_profile public.xunxu_profiles;
  v_upload xunxu_private.image_uploads; v_data jsonb; v_metadata jsonb; v_object_owner text;
  v_images text[]; v_now timestamptz;
begin
  select * into v_profile from public.xunxu_profiles where owner_id=v_actor and id=p_profile_id for update;
  if not found then perform xunxu_private.fail('PT404','PROFILE_NOT_FOUND','找不到当前账号的档案。'); end if;
  if p_revision is distinct from v_profile.revision then
    perform xunxu_private.fail('PT409','REVISION_CONFLICT','云端档案已更新，请读取最新版本后再保存。',jsonb_build_object('currentRevision',v_profile.revision));
  end if;
  if p_name is not null and (char_length(btrim(p_name)) not between 1 and 48 or p_name ~ '[[:cntrl:]]') then
    perform xunxu_private.fail('PT400','INVALID_NAME','档案名称应为 1–48 字。');
  end if;
  v_data := xunxu_private.normalise_data(p_data,p_profile_id);
  if p_upload_id is not null then
    select * into v_upload from xunxu_private.image_uploads
      where id=p_upload_id and owner_id=v_actor and profile_id=p_profile_id for update;
    if not found then perform xunxu_private.fail('PT404','UPLOAD_NOT_FOUND','截图上传凭据不属于当前档案。'); end if;
    if v_upload.state <> 'pending' or v_upload.expires_at <= clock_timestamp() or v_upload.expected_revision <> p_revision then
      perform xunxu_private.fail('PT409','UPLOAD_EXPIRED','截图上传凭据已使用或过期，请重新上传。');
    end if;
    if not exists(select 1 from jsonb_array_elements(v_data->'records') r where r->>'id'=v_upload.record_id) then
      perform xunxu_private.fail('PT400','IMAGE_RECORD_MISSING','截图必须属于本次保存的一条成绩。');
    end if;
    select metadata, owner_id into v_metadata,v_object_owner from storage.objects
      where bucket_id='xunxu-results' and name=v_upload.object_key for share;
    if not found then perform xunxu_private.fail('PT409','IMAGE_NOT_UPLOADED','截图尚未上传完成，请重试。'); end if;
    if v_object_owner is distinct from v_actor::text
      or coalesce(v_metadata->>'mimetype','') <> v_upload.mime_type
      or coalesce(v_metadata->>'size','') !~ '^[0-9]{1,12}$' then
      perform xunxu_private.fail('PT400','IMAGE_METADATA_MISMATCH','截图类型、大小或归属与上传凭据不一致。');
    end if;
    if (v_metadata->>'size')::bigint <> v_upload.size_bytes or (v_metadata->>'size')::bigint > 12582912 then
      perform xunxu_private.fail('PT400','IMAGE_METADATA_MISMATCH','截图大小与上传凭据不一致。');
    end if;
  end if;
  v_now := clock_timestamp();
  -- These changes and the profile revision commit in one database transaction.
  update xunxu_private.image_uploads i set state='retired',cleanup_after=v_now,cleanup_lease_until=null,cleaned_at=null
    where i.owner_id=v_actor and i.profile_id=p_profile_id and i.state='attached'
      and (not exists(select 1 from jsonb_array_elements(v_data->'records') r where r->>'id'=i.record_id)
        or (p_upload_id is not null and i.record_id=v_upload.record_id));
  if p_upload_id is not null then
    update xunxu_private.image_uploads set state='attached',cleanup_after=null
      where id=p_upload_id and owner_id=v_actor and profile_id=p_profile_id and state='pending';
  end if;
  select coalesce(array_agg(record_id),'{}'::text[]) into v_images from xunxu_private.image_uploads
    where owner_id=v_actor and profile_id=p_profile_id and state='attached';
  v_data := xunxu_private.normalise_data(v_data,p_profile_id,v_images);
  update public.xunxu_profiles set data=v_data,name=coalesce(btrim(p_name),name),revision=revision+1,updated_at=v_now
    where owner_id=v_actor and id=p_profile_id returning * into v_profile;
  return jsonb_build_object('profile',xunxu_private.profile_json(v_profile));
end;
$$;

create function public.xunxu_get_image_key(p_profile_id text,p_record_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.require_actor(); v_key text;
begin
  select i.object_key into v_key from xunxu_private.image_uploads i
    join public.xunxu_profiles p on p.owner_id=i.owner_id and p.id=i.profile_id
    where i.owner_id=v_actor and i.profile_id=p_profile_id and i.record_id=p_record_id and i.state='attached';
  if not found then perform xunxu_private.fail('PT404','IMAGE_NOT_FOUND','当前档案没有这张截图。'); end if;
  return jsonb_build_object('bucket','xunxu-results','key',v_key);
end;
$$;

create function public.xunxu_claim_cleanup(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.require_actor(); v_items jsonb; v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 25 then perform xunxu_private.fail('PT400','INVALID_LIMIT','清理批次应为 1–25 张。'); end if;
  -- Pending uploads are retired before any deletion permission is granted.
  -- Locking this row serializes retirement against INSERT policy and attachment.
  update xunxu_private.image_uploads i set state='retired',cleanup_after=clock_timestamp()+interval '2 minutes'
    where i.owner_id=v_actor and i.state='pending'
      and (i.expires_at <= clock_timestamp() or not exists(select 1 from public.xunxu_profiles p
        where p.owner_id=v_actor and p.id=i.profile_id and p.revision=i.expected_revision));
  with chosen as (
    select i.id from xunxu_private.image_uploads i
    where i.owner_id=v_actor and i.state='retired' and i.cleanup_after<=v_now
      and (i.cleanup_lease_until is null or i.cleanup_lease_until<=v_now)
      and (i.cleaned_at is null or exists(select 1 from storage.objects o where o.bucket_id='xunxu-results' and o.name=i.object_key))
    order by i.cleanup_after,i.id limit p_limit for update skip locked
  ), claimed as (
    update xunxu_private.image_uploads i set cleanup_lease_until=v_now+interval '5 minutes',cleanup_attempts=cleanup_attempts+1
    from chosen c where i.id=c.id and i.owner_id=v_actor and i.state='retired'
    returning i.id,i.object_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('uploadId',id,'bucket','xunxu-results','key',object_key)),'[]'::jsonb) into v_items from claimed;
  return jsonb_build_object('items',v_items);
end;
$$;

create function public.xunxu_ack_cleanup(p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.require_actor(); v_upload xunxu_private.image_uploads;
begin
  select * into v_upload from xunxu_private.image_uploads where id=p_upload_id and owner_id=v_actor for update;
  if not found then perform xunxu_private.fail('PT404','UPLOAD_NOT_FOUND','找不到当前账号的清理记录。'); end if;
  if v_upload.state <> 'retired' or v_upload.cleanup_lease_until is null then
    perform xunxu_private.fail('PT409','CLEANUP_NOT_CLAIMED','这张截图尚未进入清理批次。');
  end if;
  if exists(select 1 from storage.objects where bucket_id='xunxu-results' and name=v_upload.object_key) then
    perform xunxu_private.fail('PT409','IMAGE_STILL_EXISTS','截图尚未从私有存储移除。');
  end if;
  update xunxu_private.image_uploads set cleaned_at=clock_timestamp(),cleanup_lease_until=null
    where id=p_upload_id and owner_id=v_actor and state='retired';
  return jsonb_build_object('ok',true);
end;
$$;

-- These non-exposed helpers are the only private functions executable by an
-- authenticated role. A caller can never supply a different owner.
create function xunxu_private.can_insert_image(p_bucket text,p_key text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := xunxu_private.verified_uid(); v_upload xunxu_private.image_uploads;
begin
  if p_bucket <> 'xunxu-results' or v_actor is null then return false; end if;
  select * into v_upload from xunxu_private.image_uploads where owner_id=v_actor and object_key=p_key for update;
  return found and v_upload.state='pending' and v_upload.expires_at>clock_timestamp();
end;
$$;

create function xunxu_private.can_select_image(p_bucket text,p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_bucket='xunxu-results' and exists(select 1 from xunxu_private.image_uploads
    where owner_id=xunxu_private.verified_uid() and object_key=p_key
      and (state='attached' or (state='retired' and cleanup_lease_until>clock_timestamp())))
$$;

create function xunxu_private.can_delete_image(p_bucket text,p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_bucket='xunxu-results' and exists(select 1 from xunxu_private.image_uploads
    where owner_id=xunxu_private.verified_uid() and object_key=p_key
      and state='retired' and cleanup_after<=clock_timestamp() and cleanup_lease_until>clock_timestamp())
$$;

create policy xunxu_image_insert on storage.objects for insert to authenticated
  with check (bucket_id='xunxu-results' and xunxu_private.can_insert_image(bucket_id,name));
create policy xunxu_image_select on storage.objects for select to authenticated
  using (bucket_id='xunxu-results' and xunxu_private.can_select_image(bucket_id,name));
create policy xunxu_image_delete on storage.objects for delete to authenticated
  using (bucket_id='xunxu-results' and xunxu_private.can_delete_image(bucket_id,name));
-- Restrictive guards stop an unrelated broad Storage policy from opening this
-- private bucket. No UPDATE/upsert is allowed for versioned image objects.
create policy xunxu_image_insert_guard on storage.objects as restrictive for insert to public
  with check (bucket_id<>'xunxu-results' or xunxu_private.can_insert_image(bucket_id,name));
create policy xunxu_image_select_guard on storage.objects as restrictive for select to public
  using (bucket_id<>'xunxu-results' or xunxu_private.can_select_image(bucket_id,name));
create policy xunxu_image_delete_guard on storage.objects as restrictive for delete to public
  using (bucket_id<>'xunxu-results' or xunxu_private.can_delete_image(bucket_id,name));
create policy xunxu_image_update_guard on storage.objects as restrictive for update to public
  using (bucket_id<>'xunxu-results') with check (bucket_id<>'xunxu-results');

revoke all on all functions in schema xunxu_private from public, anon, authenticated;
grant usage on schema xunxu_private to authenticated;
grant execute on function xunxu_private.verified_uid(),
  xunxu_private.can_insert_image(text,text),xunxu_private.can_select_image(text,text),
  xunxu_private.can_delete_image(text,text) to authenticated;

revoke all on function public.xunxu_list_profiles(),public.xunxu_get_profile(text),
  public.xunxu_create_profile(text,text,jsonb),public.xunxu_save_profile(text,bigint,jsonb,text,uuid),
  public.xunxu_prepare_image(text,text,bigint,text,bigint),public.xunxu_get_image_key(text,text),
  public.xunxu_claim_cleanup(integer),public.xunxu_ack_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.xunxu_list_profiles(),public.xunxu_get_profile(text),
  public.xunxu_create_profile(text,text,jsonb),public.xunxu_save_profile(text,bigint,jsonb,text,uuid),
  public.xunxu_prepare_image(text,text,bigint,text,bigint),public.xunxu_get_image_key(text,text),
  public.xunxu_claim_cleanup(integer),public.xunxu_ack_cleanup(uuid) to authenticated;

comment on table public.xunxu_profiles is 'Verified Supabase Auth private profiles; writes only through owner-checked CAS RPCs.';
comment on table xunxu_private.image_uploads is 'Private versioned image tickets and durable owner-driven cleanup tombstones. Never delete storage.objects with SQL.';
commit;
