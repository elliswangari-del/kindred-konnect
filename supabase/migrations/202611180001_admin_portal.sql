create table public.membership_status_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  previous_status text not null check (previous_status in ('pending','approved','rejected','suspended')),
  new_status text not null check (new_status in ('pending','approved','rejected','suspended')),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.membership_status_history enable row level security;
create policy "Admins read membership status history"
  on public.membership_status_history for select to authenticated
  using ((select public.kindred_is_admin()));
revoke all on public.membership_status_history from public, anon, authenticated;
grant select on public.membership_status_history to authenticated;

create or replace function public.kindred_record_member_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.membership_status_history(member_id,previous_status,new_status,changed_by)
  values(new.id,old.status,new.status,(select auth.uid()));
  return new;
end;
$$;
revoke all on function public.kindred_record_member_status() from public, anon, authenticated;
create trigger kindred_profile_status_history
  after update of status on public.profiles
  for each row
  when (old.status is distinct from new.status)
  execute function public.kindred_record_member_status();

create or replace function public.admin_set_member_status(target_user_id uuid,new_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.kindred_is_admin()) then raise exception 'Administrator access required'; end if;
  if new_status is null or new_status not in ('approved','rejected','suspended') then raise exception 'Invalid member status'; end if;
  if target_user_id=(select auth.uid()) then raise exception 'You cannot change your own member status'; end if;
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Member not found'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then raise exception 'Administrator records cannot be changed'; end if;

  update public.profiles set status=new_status,updated_at=now() where id=target_user_id and role='member';
  if not found then raise exception 'Member not found'; end if;

  insert into public.notifications(user_id,title,body)
  values(target_user_id,'Membership status updated',case new_status
    when 'approved' then 'Your Kindred Konnect membership is approved. Welcome to the community!'
    when 'rejected' then 'Your Kindred Konnect membership request has been declined.'
    else 'Your Kindred Konnect membership is suspended. Contact an administrator for help.'
  end);
end;
$$;
revoke all on function public.admin_set_member_status(uuid,text) from public, anon;
grant execute on function public.admin_set_member_status(uuid,text) to authenticated;
