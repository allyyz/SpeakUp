const DB = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

(function seed() {
  const users = DB.get('users', []);
  if (!users.find(u => u.role === 'hr')) {
    users.push({ name: 'HR Admin', email: 'hr@company.com', password: 'hr123', role: 'hr' });
    DB.set('users', users);
  }
})();

const currentUser = () => DB.get('currentUser', null);
const privacyAccepted = u => DB.get('privacy:' + u.email, false);
const policyOK = () => sessionStorage.getItem('policyOK') === '1';

function requireRole(role) {
  const u = currentUser();
  if (!u || u.role !== role) location.href = 'index.html';
  return u;
}
function goHome(u) {
  sessionStorage.removeItem('policyOK');
  location.href = 'privacy.html';
}
function continueAfterPolicy(u) {
  sessionStorage.setItem('policyOK', '1');
  DB.set('privacy:' + u.email, true);
  location.href = u.role === 'hr' ? 'hr.html' : 'employee.html';
}
function logout() { localStorage.removeItem('currentUser'); sessionStorage.removeItem('policyOK'); location.href = 'index.html'; }

const STATUSES = ['New', 'Under Review', 'Under Investigation', 'Resolved', 'Unsubstantiated', 'Dismissed'];
const CLOSED = ['Resolved', 'Unsubstantiated', 'Dismissed'];
const PRIORITIES = ['Easy', 'Moderate', 'Difficult'];
const allReports = () => DB.get('reports', []);
const myReports = u => allReports().filter(r => r.owner === u.email && !r.hidden);

function notify(email, text) {
  const n = DB.get('notifications', []);
  n.unshift({ email, text, date: new Date().toLocaleString(), read: false });
  DB.set('notifications', n);
}
const myNotifs = u => DB.get('notifications', []).filter(n => n.email === u.email);

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function saveReport(r) {
  const all = allReports();
  all.unshift(r);
  DB.set('reports', all);
}
function newCaseId() {
  return 'SU-' + String(allReports().length + 1).padStart(4, '0');
}
function updateReport(id, changes) {
  const all = allReports();
  const r = all.find(x => x.id === id);
  if (!r) return null;
  Object.assign(r, changes);
  DB.set('reports', all);
  return r;
}

function countBy(list, key, values) {
  return values.map(v => ({ label: v, n: list.filter(r => r[key] === v).length }));
}
function lastMonths(count) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      y: m.getFullYear(), m: m.getMonth(),
      label: m.toLocaleString('en', { month: 'short', year: '2-digit' })
    });
  }
  return out;
}

function stepsHTML(status) {
  const flow = ['New', 'Under Review', 'Under Investigation'];
  const end = (status === 'Unsubstantiated' || status === 'Dismissed') ? status : 'Resolved';
  const all = flow.concat(end);
  const idx = all.indexOf(status);
  return all.map((s, i) => `<div class="${i <= idx ? 'done' : ''}">${s}</div>`).join('');
}

function readFiles(fileList) {
  const MAX = 1024 * 1024;
  return Promise.all(Array.from(fileList).map(f => new Promise(res => {
    if (f.size > MAX) return res({ name: f.name, tooBig: true });
    const rd = new FileReader();
    rd.onload = () => res({ name: f.name, type: f.type, data: rd.result });
    rd.onerror = () => res({ name: f.name, tooBig: true });
    rd.readAsDataURL(f);
  })));
}
function evidenceHTML(r) {
  if (!r.evidence || !r.evidence.length) return '';
  return '<div style="margin-top:.8rem"><small>Evidence:</small>' + r.evidence.map(e => {
    if (typeof e === 'string') return '<div><small>' + esc(e) + ' (name only)</small></div>';
    const img = (e.type || '').startsWith('image/')
      ? '<br><img src="' + e.data + '" style="max-width:100%;max-height:260px;border-radius:8px;margin:.3rem 0">'
      : '';
    return '<div>📎 <a href="' + e.data + '" download="' + esc(e.name) + '">' + esc(e.name) + '</a>' + img + '</div>';
  }).join('') + '</div>';
}

const directory = () => DB.get('directory', []);
function saveDirectory(list) { DB.set('directory', list); }

(function migratePriority() {
  const map = { Low: 'Easy', Medium: 'Moderate', High: 'Difficult' };
  const list = DB.get('reports', []);
  let changed = false;
  list.forEach(r => { if (map[r.priority]) { r.priority = map[r.priority]; changed = true; } });
  if (changed) DB.set('reports', list);
})();

const LOGO = '<svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#fff"/><path d="M8 9h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H15l-5 4v-4H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="#0fa3a3"/><rect x="15" y="12" width="2" height="5" rx="1" fill="#fff"/><circle cx="16" cy="19" r="1.2" fill="#fff"/></svg>';

function navHTML(u) {
  const links = u.role === 'hr'
    ? [['hr.html','Dashboard'],['cases.html','Cases'],['trends.html','Trends'],['accounts.html','Accounts']]
    : [['employee.html','Dashboard'],['submit.html','Submit'],['my-reports.html','My Reports']];
  const unread = myNotifs(u).filter(n => !n.read).length;
  links.push(['notifications.html', 'Notifications' + (unread ? ' (' + unread + ')' : '')],
             ['privacy-data.html', 'Privacy']);
  return '<b>' + LOGO + 'SpeakUp' + (u.role === 'hr' ? ' HR' : '') + '</b>' +
    links.map(l => `<a href="${l[0]}">${l[1]}</a>`).join('') +
    '<a href="#" onclick="logout()">Logout</a>';
}