const sections = [
  ['dashboard', 'Overview'],
  ['requests', 'Membership requests'],
  ['members', 'Member management'],
  ['history', 'Decision history'],
];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);

const dateLabel = (value) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const sectionUrl = (section) => `?page=admin&section=${section}`;
const badge = (status) => `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;

function actions(member) {
  const button = (status, label, ghost = false) =>
    `<button class="btn ${ghost ? 'ghost ' : ''}small" data-member-status="${status}" data-user-id="${escapeHtml(member.id)}">${label}</button>`;
  if (member.status === 'pending') return `${button('approved', 'Approve')} ${button('rejected', 'Reject', true)}`;
  if (member.status === 'approved') return button('suspended', 'Suspend', true);
  if (member.status === 'suspended') return button('approved', 'Reactivate');
  if (member.status === 'rejected') return button('approved', 'Approve');
  return '';
}

function memberTable(members, emptyText) {
  const rows = members.map((member) => `<tr>
    <td>${escapeHtml(member.display_name)}</td>
    <td>${escapeHtml(member.email)}</td>
    <td>${badge(member.status)}</td>
    <td>${dateLabel(member.created_at)}</td>
    <td class="admin-actions">${actions(member)}</td>
  </tr>`).join('');
  return `<div class="admin-table-wrap"><table class="table admin-table">
    <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Registered</th><th>Manage</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5"><div class="empty">${escapeHtml(emptyText)}</div></td></tr>`}</tbody>
  </table></div>`;
}

function adminFrame(section, title, description, content, notice = '') {
  const nav = sections.map(([key, label]) =>
    `<a class="${section === key ? 'active' : ''}" href="${sectionUrl(key)}">${label}</a>`).join('');
  return `<main class="app-shell admin-shell"><div class="wrap">
    <div class="app-top admin-heading"><div><p class="eyebrow">Kindred Konnect · Administration</p><h1>${title}</h1><p class="muted">${description}</p></div><span class="badge">Administrator</span></div>
    <div class="admin-layout"><nav class="side-nav admin-nav" aria-label="Administrator pages">${nav}</nav>
      <div class="main-panel" data-admin-portal>
        <div id="admin-status-message" class="${notice ? 'alert success' : ''}" role="status" aria-live="polite">${escapeHtml(notice)}</div>
        ${content}
      </div>
    </div>
  </div></main>`;
}

function restricted() {
  return `<main class="app-shell"><div class="wrap"><section class="panel empty">
    <b>Administrator access only</b><p>This page is restricted to approved administrators.</p>
  </section></div></main>`;
}

export async function renderAdminPortal(db, notice = '') {
  if (!db) throw new Error('Supabase is not configured.');
  const { data: { session }, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return restricted();

  const { data: profile, error: profileError } = await db.from('profiles')
    .select('role,status').eq('id', session.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role !== 'admin' || profile.status !== 'approved') return restricted();

  const requestedSection = new URLSearchParams(location.search).get('section');
  const section = sections.some(([key]) => key === requestedSection) ? requestedSection : 'dashboard';
  const { data, error } = await db.rpc('admin_list_members');
  if (error) throw error;
  const members = (data ?? []).filter((member) => member.role === 'member');
  const pending = members.filter((member) => member.status === 'pending');
  const approved = members.filter((member) => member.status === 'approved');
  const rejected = members.filter((member) => member.status === 'rejected');
  const suspended = members.filter((member) => member.status === 'suspended');

  if (section === 'requests') {
    return adminFrame(section, 'Membership requests', 'Review applications awaiting a decision.',
      `<section class="panel"><div class="admin-section-heading"><div><h2>Pending members</h2><p class="muted">Approve or decline each membership request.</p></div><span class="badge pending">${pending.length} pending</span></div>
        ${memberTable(pending, 'There are no pending membership requests.')}</section>`, notice);
  }

  if (section === 'members') {
    const managed = members.filter((member) => member.status !== 'pending');
    return adminFrame(section, 'Member management', 'Manage approved, rejected, and suspended member accounts.',
      `<section class="panel"><div class="admin-section-heading"><div><h2>Community members</h2><p class="muted">Administrator accounts are protected and are not listed here.</p></div><span class="badge">${managed.length} members</span></div>
        ${memberTable(managed, 'No member accounts to manage yet.')}</section>`, notice);
  }

  if (section === 'history') {
    const { data: history, error: historyError } = await db.from('membership_status_history')
      .select('id,member_id,previous_status,new_status,changed_by,changed_at')
      .in('new_status', ['approved', 'rejected'])
      .order('changed_at', { ascending: false }).limit(200);
    if (historyError) throw historyError;
    const memberById = new Map(members.map((member) => [member.id, member]));
    const rows = (history ?? []).map((entry) => {
      const member = memberById.get(entry.member_id);
      return `<tr><td>${escapeHtml(member?.display_name || 'Member account')}</td>
        <td>${escapeHtml(member?.email || 'Unavailable')}</td>
        <td>${badge(entry.previous_status)} <span aria-hidden="true">→</span> ${badge(entry.new_status)}</td>
        <td>${entry.changed_by ? 'Administrator' : 'System'}</td>
        <td>${dateLabel(entry.changed_at)}</td></tr>`;
    }).join('');
    const table = `<div class="admin-table-wrap"><table class="table admin-table">
      <thead><tr><th>Member</th><th>Email</th><th>Decision</th><th>Recorded by</th><th>Date</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5"><div class="empty"><b>No decision history yet.</b>Membership decisions made from now on will appear here.</div></td></tr>'}</tbody>
    </table></div>`;
    return adminFrame(section, 'Decision history', 'Review recorded approvals and declined membership requests.',
      `<section class="panel"><div class="admin-section-heading"><div><h2>Approved and rejected requests</h2><p class="muted">The database records each status transition securely.</p></div></div>${table}</section>`, notice);
  }

  const { count, error: mediaError } = await db.from('media').select('id', { count: 'exact', head: true });
  if (mediaError) throw mediaError;
  const mediaCount = count ?? 0;
  const cards = [
    ['Registered members', members.length, 'members'],
    ['Approved', approved.length, 'members'],
    ['Pending requests', pending.length, 'requests'],
    ['Rejected', rejected.length, 'history'],
    ['Suspended', suspended.length, 'members'],
    ['Shared memories', mediaCount, 'dashboard'],
  ].map(([label, countValue, link]) => `<a class="stat-card admin-stat" href="${sectionUrl(link)}"><strong>${countValue}</strong><span>${label}</span></a>`).join('');
  const { data: recentMedia, error: mediaListError } = await db.from('media')
    .select('id,caption,created_at,kind,profiles(display_name)')
    .order('created_at', { ascending: false }).limit(10);
  if (mediaListError) throw mediaListError;
  const moderation = (recentMedia ?? []).map((media) => `<div class="row moderation-item">
    <div><strong>${escapeHtml(media.caption || 'Shared memory')}</strong>
      <div class="form-note">${escapeHtml(media.profiles?.display_name || 'Member')} · ${dateLabel(media.created_at)} · ${escapeHtml(media.kind)}</div>
    </div><button class="btn ghost small" data-delete-media="${escapeHtml(media.id)}">Remove content</button>
  </div>`).join('') || '<p class="form-note">No community uploads yet.</p>';
  const recent = pending.slice(0, 5);
  return adminFrame('dashboard', 'Admin dashboard', 'A secure overview of your community and membership activity.',
    `<div class="stats admin-stats">${cards}</div>
      <section class="panel admin-dashboard-panel">
        <div class="admin-section-heading"><div><h2>Membership requests</h2><p class="muted">New applications waiting for review.</p></div><a class="btn ghost small" href="${sectionUrl('requests')}">View all requests</a></div>
        ${memberTable(recent, 'You are all caught up. No requests need review.')}
      </section>
      <section class="panel admin-dashboard-panel">
        <div class="admin-section-heading"><div><h2>Community moderation · Recent uploads</h2><p class="muted">Remove content that should no longer be shared.</p></div></div>
        ${moderation}
      </section>
      <div class="admin-quick-links"><a class="panel" href="${sectionUrl('members')}"><b>Manage members</b><span>Review current membership status and take action.</span></a>
        <a class="panel" href="${sectionUrl('history')}"><b>Decision history</b><span>See approval and rejection records.</span></a></div>`, notice);
}

export function wireAdminPortal(db, refresh) {
  const root = document.querySelector('[data-admin-portal]');
  if (!root) return () => {};
  const click = async (event) => {
    const button = event.target.closest('[data-member-status], [data-delete-media]');
    if (!button || !root.contains(button)) return;
    if (button.dataset.deleteMedia) {
      if (!window.confirm('Delete this memory? This cannot be undone.')) return;
      button.disabled = true;
      try {
        const { data: media, error: readError } = await db.from('media')
          .select('storage_path').eq('id', button.dataset.deleteMedia).maybeSingle();
        if (readError) throw readError;
        if (!media) throw new Error('The memory was not found.');
        const { error: deleteError } = await db.from('media').delete().eq('id', button.dataset.deleteMedia);
        if (deleteError) throw deleteError;
        const { error: storageError } = await db.storage.from('memories').remove([media.storage_path]);
        const notice = storageError
          ? `Memory removed from the album, but its stored file could not be deleted: ${storageError.message}`
          : 'Memory removed from the album.';
        await refresh(notice);
      } catch (error) {
        const message = document.querySelector('#admin-status-message');
        if (message) {
          message.className = 'alert error';
          message.textContent = error?.message || 'The memory could not be removed.';
        }
        button.disabled = false;
      }
      return;
    }
    const status = button.dataset.memberStatus;
    if (status === 'rejected' && !window.confirm('Decline this membership request?')) return;
    if (status === 'suspended' && !window.confirm('Suspend this member?')) return;

    button.disabled = true;
    const message = document.querySelector('#admin-status-message');
    try {
      const { error } = await db.rpc('admin_set_member_status', {
        target_user_id: button.dataset.userId,
        new_status: status,
      });
      if (error) throw error;

      let notice = `Member status updated to ${status}.`;
      if (status === 'approved' || status === 'rejected') {
        const { error: emailError } = await db.functions.invoke('send-membership-email', {
          body: { target_user_id: button.dataset.userId, status },
        });
        if (emailError) notice += ` Email notification failed: ${emailError.message}`;
        else notice += ' Email notification sent.';
      }
      await refresh(notice);
    } catch (error) {
      if (message) {
        message.className = 'alert error';
        message.textContent = error?.message || 'The membership update could not be completed.';
      }
      button.disabled = false;
    }
  };
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}
