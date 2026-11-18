-- Apply as the Supabase project owner. No service-role key is used in the browser.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'member' check (role in ('member','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.kindred_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and status='approved');
$$;
revoke all on function public.kindred_is_admin() from public, anon;
grant execute on function public.kindred_is_admin() to authenticated;
create or replace function public.kindred_is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and status='approved');
$$;
revoke all on function public.kindred_is_approved() from public, anon;
grant execute on function public.kindred_is_approved() to authenticated;

-- Broadcast and presence use a private Realtime topic; pending users cannot
-- discover member names, online status, or typing activity on this channel.
create policy "Approved members join Kindred chat realtime" on realtime.messages
  for select to authenticated
  using (realtime.topic()='kindred-group-chat' and (select public.kindred_is_approved()));
create policy "Approved members publish Kindred chat realtime" on realtime.messages
  for insert to authenticated
  with check (realtime.topic()='kindred-group-chat' and (select public.kindred_is_approved()));

create policy "Members see own profile and admins see all" on public.profiles for select to authenticated
  using (id=(select auth.uid()) or (select public.kindred_is_admin()));
create policy "Approved members see approved community profiles" on public.profiles for select to authenticated
  using (status='approved' and (select public.kindred_is_approved()));
create policy "Members update own safe fields" on public.profiles for update to authenticated
  using (id=(select auth.uid()) and status='approved') with check (id=(select auth.uid()) and status='approved');
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,avatar_path) on public.profiles to authenticated;

create or replace function public.kindred_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name,role,status)
  values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),'Kindred Konnect member'),80),'member','pending');
  return new;
end;
$$;
revoke all on function public.kindred_create_profile() from public, anon, authenticated;
create trigger kindred_auth_user_profile after insert on auth.users for each row execute function public.kindred_create_profile();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(char_length(title)<=120),
  body text not null check(char_length(body)<=500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "Members see their own notifications" on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy "Members mark their own notifications read" on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,update(read_at) on public.notifications to authenticated;
alter publication supabase_realtime add table public.notifications;

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  room_name text not null,
  started_by uuid not null references public.profiles(id) on delete cascade,
  call_kind text not null check(call_kind in ('audio','video')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.call_sessions enable row level security;
create policy "Approved members read call sessions" on public.call_sessions for select to authenticated using((select public.kindred_is_approved()));
create policy "Approved members start call sessions" on public.call_sessions for insert to authenticated with check(started_by=(select auth.uid()) and (select public.kindred_is_approved()));
create policy "Caller ends own call session" on public.call_sessions for update to authenticated using(started_by=(select auth.uid())) with check(started_by=(select auth.uid()));
grant select,insert,update on public.call_sessions to authenticated;
alter publication supabase_realtime add table public.call_sessions;
create or replace function public.kindred_notify_call()
returns trigger language plpgsql security definer set search_path = '' as $$
declare starter text;
begin
  select display_name into starter from public.profiles where id=new.started_by;
  insert into public.notifications(user_id,title,body)
  select p.id,'Kindred call started',coalesce(starter,'A member')||' started a '||new.call_kind||' call. Join the community room to take part.'
  from public.profiles p where p.status='approved' and p.id<>new.started_by;
  return new;
end;
$$;
revoke all on function public.kindred_notify_call() from public,anon,authenticated;
create trigger kindred_call_notification after insert on public.call_sessions for each row execute function public.kindred_notify_call();

create or replace function public.admin_set_member_status(target_user_id uuid,new_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.kindred_is_admin()) then raise exception 'Administrator access required'; end if;
  if new_status not in ('approved','rejected','suspended') then raise exception 'Invalid member status'; end if;
  if target_user_id=(select auth.uid()) then raise exception 'You cannot change your own member status'; end if;
  update public.profiles set status=new_status,updated_at=now() where id=target_user_id;
  if not found then raise exception 'Member not found'; end if;
  insert into public.notifications(user_id,title,body)
  values(target_user_id,'Membership status updated',case new_status when 'approved' then 'Your Kindred Konnect membership is approved. Welcome to the community!' when 'rejected' then 'Your Kindred Konnect membership request has been declined.' else 'Your Kindred Konnect membership is suspended. Contact an administrator for help.' end);
end;
$$;
revoke all on function public.admin_set_member_status(uuid,text) from public, anon;
grant execute on function public.admin_set_member_status(uuid,text) to authenticated;

create or replace function public.admin_list_members()
returns table(id uuid,display_name text,email text,status text,role text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.kindred_is_admin()) then raise exception 'Administrator access required'; end if;
  return query select p.id,p.display_name,u.email::text,p.status,p.role,p.created_at
    from public.profiles p join auth.users u on u.id=p.id order by p.created_at desc;
end;
$$;
revoke all on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body)<=4000),
  attachment_path text,
  attachment_kind text check(attachment_kind in ('image','audio')),
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create policy "Approved members read messages" on public.messages for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Approved members send own messages" on public.messages for insert to authenticated
 with check (sender_id=(select auth.uid()) and (char_length(body)>0 or attachment_path is not null) and (attachment_path is null or attachment_path like (select auth.uid())::text||'/%') and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
grant select,insert on public.messages to authenticated;
alter publication supabase_realtime add table public.messages;
create or replace function public.kindred_notify_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sender_name text;
begin
  select display_name into sender_name from public.profiles where id=new.sender_id;
  insert into public.notifications(user_id,title,body)
  select p.id,'New community message',left(coalesce(sender_name,'A Kindred member')||' shared a message with the group.',500)
  from public.profiles p where p.status='approved' and p.id<>new.sender_id;
  return new;
end;
$$;
revoke all on function public.kindred_notify_message() from public,anon,authenticated;
create trigger kindred_message_notification after insert on public.messages for each row execute function public.kindred_notify_message();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-files','chat-files',false,25000000,array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict(id) do update set public=false,file_size_limit=25000000;
create policy "Approved members read community attachments" on storage.objects for select to authenticated
 using(bucket_id='chat-files' and (select public.kindred_is_approved()));
create policy "Approved members upload own attachments" on storage.objects for insert to authenticated
 with check(bucket_id='chat-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.kindred_is_approved()));

create table public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  kind text not null check(kind in ('image','video')),
  caption text not null default '' check(char_length(caption)<=300),
  created_at timestamptz not null default now()
);
alter table public.media enable row level security;
create policy "Approved members read media" on public.media for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Approved members upload own media" on public.media for insert to authenticated
 with check (owner_id=(select auth.uid()) and storage_path like (select auth.uid())::text||'/%' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Owners or admins delete media" on public.media for delete to authenticated
 using ((owner_id=(select auth.uid()) or (select public.kindred_is_admin())) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
grant select,insert,delete on public.media to authenticated;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
create policy "Approved members read comments" on public.comments for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Approved members comment as self" on public.comments for insert to authenticated
 with check (user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
grant select,insert on public.comments to authenticated;

create table public.likes (
  media_id uuid not null references public.media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(media_id,user_id)
);
alter table public.likes enable row level security;
create policy "Approved members read likes" on public.likes for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Approved members like as self" on public.likes for insert to authenticated
 with check (user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Members remove own likes" on public.likes for delete to authenticated using(user_id=(select auth.uid()));
grant select,insert,delete on public.likes to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('memories','memories',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=52428800;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880;
create policy "Approved members view private memories" on storage.objects for select to authenticated
 using(bucket_id='memories' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Approved members upload own memories" on storage.objects for insert to authenticated
 with check(bucket_id='memories' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Owners and admins remove memories" on storage.objects for delete to authenticated
 using(bucket_id='memories' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.kindred_is_admin())) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved'));
create policy "Members see own avatar" on storage.objects for select to authenticated
 using(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Approved members see approved member avatars" on storage.objects for select to authenticated
 using(bucket_id='avatars' and (select public.kindred_is_approved()) and exists(select 1 from public.profiles p where p.id::text=(storage.foldername(name))[1] and p.status='approved'));
create policy "Members upload own avatar" on storage.objects for insert to authenticated
 with check(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Members update own avatar" on storage.objects for update to authenticated
 using(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text)
 with check(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- After your first account is confirmed, run as project owner in SQL Editor:
-- update public.profiles p set role='admin',status='approved'
-- from auth.users u where u.id=p.id and u.email='owner@example.com';
