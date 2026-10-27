const CLOUD = {
  project: 'speakup-dcdee',
  key: 'AIzaSyDSpsuheM9f7zX8HMSqHQsl_tZ0dy4yd-A',
  shared: ['users', 'directory', 'reports', 'notifications']
};
const CLOUD_URL = 'https://firestore.googleapis.com/v1/projects/' + CLOUD.project + '/databases/(default)/documents/kv';
const cloudCache = {};

function cloudReq(method, url, body) {
  const x = new XMLHttpRequest();
  x.open(method, url, false);
  x.setRequestHeader('Content-Type', 'application/json');
  x.send(body ? JSON.stringify(body) : null);
  if (x.status < 200 || x.status >= 300) throw new Error(x.status + ' ' + x.responseText);
  return JSON.parse(x.responseText || '{}');
}

(function cloudLoad() {
  try {
    let more = '';
    do {
      const r = cloudReq('GET', CLOUD_URL + '?pageSize=300&key=' + CLOUD.key + more);
      (r.documents || []).forEach(d => {
        cloudCache[d.name.split('/').pop()] = d.fields.v.stringValue;
      });
      more = r.nextPageToken ? '&pageToken=' + encodeURIComponent(r.nextPageToken) : '';
    } while (more);
  } catch (e) { console.error('Cloud load failed', e); }
})();

const DB = {
  get(k, d) {
    try {
      const raw = CLOUD.shared.includes(k) ? cloudCache[k] : localStorage.getItem(k);
      if (raw == null) return d;
      return JSON.parse(raw) ?? d;
    } catch (e) { return d; }
  },
  set(k, v) {
    const s = JSON.stringify(v);
    if (CLOUD.shared.includes(k)) {
      cloudCache[k] = s;
      try {
        cloudReq('PATCH', CLOUD_URL + '/' + k + '?key=' + CLOUD.key,
          { fields: { v: { stringValue: s } } });
      } catch (e) {
        alert('Cannot save online. Please check your internet connection.');
        throw e;
      }
    } else {
      localStorage.setItem(k, s);
    }
  }
};

(function seed() {
  try {
    const users = DB.get('users', []);
    if (!users.find(u => u.role === 'hr')) {
      users.push({ name: 'HR Admin', email: 'hr@company.com', password: 'hr123', role: 'hr' });
      DB.set('users', users);
    }
  } catch (e) { console.error('Seed failed', e); }
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
function logout() {
  localStorage.removeItem('currentUser');
  sessionStorage.removeItem('policyOK');
  location.href = 'index.html';
}

const STATUSES = ['New', 'Under Review', 'Under Investigation', 'Resolved', 'Dismissed'];
const CLOSED = ['Resolved', 'Dismissed'];
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
  const end = status === 'Dismissed' ? 'Dismissed' : 'Resolved';
  const all = flow.concat(end);
  const idx = all.indexOf(status);
  return all.map((s, i) => `<div class="${i <= idx ? 'done' : ''}">${s}</div>`).join('');
}

function readFiles(fileList) {
  const MAX = 150 * 1024;
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

function pendingCount() {
  return DB.get('users', []).filter(x => x.role === 'employee' && x.status === 'Pending').length;
}

const LOGO = '<svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#fff"/><path d="M8 9h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H15l-5 4v-4H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="#0fa3a3"/><rect x="15" y="12" width="2" height="5" rx="1" fill="#fff"/><circle cx="16" cy="19" r="1.2" fill="#fff"/></svg>';

function navHTML(u) {
  const links = u.role === 'hr'
    ? [['hr.html','Dashboard'],['cases.html','Cases'],['trends.html','Trends'],['accounts.html','Accounts' + (pendingCount() ? ' (' + pendingCount() + ')' : '')]]
    : [['employee.html','Dashboard'],['submit.html','Submit'],['my-reports.html','My Reports']];
  const unread = myNotifs(u).filter(n => !n.read).length;
  links.push(['notifications.html', 'Notifications' + (unread ? ' (' + unread + ')' : '')],
             ['privacy-data.html', 'Privacy']);
  return '<b>' + LOGO + 'SpeakUp' + (u.role === 'hr' ? ' HR' : '') + '</b>' +
    links.map(l => `<a href="${l[0]}">${l[1]}</a>`).join('') +
    '<a href="#" onclick="logout()">Logout</a>';
}

(function migrations() {
  try {
    const pmap = { Low: 'Easy', Medium: 'Moderate', High: 'Difficult' };
    const list = DB.get('reports', []);
    let changed = false;
    list.forEach(r => {
      if (pmap[r.priority]) { r.priority = pmap[r.priority]; changed = true; }
      if (r.status === 'Unsubstantiated') { r.status = 'Dismissed'; changed = true; }
    });
    if (changed) DB.set('reports', list);
  } catch (e) { console.error('Migration failed', e); }
})();