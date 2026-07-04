// ============================================================
//  freeCar — אפליקציית הסעות שיתופיות (אב־טיפוס צד לקוח)
//  אימות: Supabase Auth  |  נתונים: localStorage
//  המבנה מוכן להחלפה עתידית ב-Backend / DB / Google Maps API.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://rwgkmsubpnjdyjhfzwpa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NUgJgQXRpxk3zoBnEwBIYA_V7JTdg6V';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- קבועי מערכת (ניתן לשנות בעתיד) ----
const OFFER_AFTER_DAYS = 2;         // אחרי כמה ימים נשלחת הצעת שינוי
const ROUTE_OVERLAP_MIN = 40;       // אחוז חפיפת מסלול מינימלי
const REJECT_BEFORE_HOURS = 48;     // חוק 48 שעות

// ============================================================
//  1. שכבת אחסון (localStorage) — עטופה כדי שיהיה קל להחליף ב-API
// ============================================================
const COLLECTIONS = ['users', 'documents', 'rideRequests', 'offers', 'payments', 'barcodeValidations'];

function saveToLocalStorage(collection, data) {
  localStorage.setItem('freecar_' + collection, JSON.stringify(data));
}
function loadFromLocalStorage(collection) {
  const raw = localStorage.getItem('freecar_' + collection);
  return raw ? JSON.parse(raw) : [];
}

// עזרי CRUD גנריים
const db = {
  all: (c) => loadFromLocalStorage(c),
  insert(c, record) {
    const arr = loadFromLocalStorage(c);
    arr.push(record);
    saveToLocalStorage(c, arr);
    return record;
  },
  update(c, id, patch) {
    const arr = loadFromLocalStorage(c);
    const i = arr.findIndex(r => r.id === id);
    if (i !== -1) { arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() }; saveToLocalStorage(c, arr); return arr[i]; }
    return null;
  },
  find: (c, id) => loadFromLocalStorage(c).find(r => r.id === id),
  where: (c, fn) => loadFromLocalStorage(c).filter(fn),
};

function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)); }

// ============================================================
//  2. מצב האפליקציה
// ============================================================
const State = {
  authUser: null,     // המשתמש מ-Supabase
  profile: null,      // רשומת המשתמש שלנו (collection users)
  role: 'user',       // user / admin / driver — החלפה לצורכי דמו
};

// ============================================================
//  3. אתחול — בדיקת התחברות
// ============================================================
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  State.authUser = session.user;
  loadOrCreateProfile();
  buildTopbar();
  wireGlobalEvents();

  // הרצת חוקים אוטומטיים ורענון תקופתי
  runAutomaticRules();
  setInterval(refreshApprovedRidesTable, 60000);   // עדכון טבלת מאושרות אחת לדקה (סעיף 9.3)
  setInterval(runAutomaticRules, 60000);

  navigate(State.profile.status === 'approved' ? 'order' : 'register');
}

// טעינה או יצירה של פרופיל המשתמש הנוכחי לפי מזהה Supabase
function loadOrCreateProfile() {
  const meta = State.authUser.user_metadata || {};
  let profile = db.all('users').find(u => u.authId === State.authUser.id);
  if (!profile) {
    profile = {
      id: uid(),
      authId: State.authUser.id,
      firstName: '', lastName: '',
      phone: '', email: State.authUser.email || '',
      homeAddress: '', homeEntrance: '',
      workAddress: '', workEntrance: '',
      commitmentApproved: false, termsApproved: false,
      status: 'pending_documents',
      avatarUrl: meta.avatar_url || meta.picture || '',
      fullNameFromGoogle: meta.full_name || meta.name || '',
      createdAt: new Date().toISOString(),
    };
    db.insert('users', profile);
  }
  State.profile = profile;
}

// ============================================================
//  4. סרגל ניווט + החלפת תפקיד
// ============================================================
const SCREENS_BY_ROLE = {
  user:   [['register','הרשמה ומסמכים'], ['order','הזמנת נסיעה'], ['status','סטטוס בקשות'], ['rides','ההסעות שלי']],
  admin:  [['admin','ניהול (Admin)']],
  driver: [['driver','מסך נהג']],
};

function buildTopbar() {
  const meta = State.authUser.user_metadata || {};
  const name = State.profile.firstName ? `${State.profile.firstName} ${State.profile.lastName}` : (meta.full_name || meta.name || State.authUser.email);
  document.getElementById('topbar').innerHTML = `
    <div class="brand"><span>🚗</span> freeCar</div>
    <nav class="nav" id="nav"></nav>
    <div class="user-box">
      <select class="role-select" id="role-select" title="החלפת תפקיד (דמו)">
        <option value="user">משתמש</option>
        <option value="admin">Admin</option>
        <option value="driver">נהג</option>
      </select>
      ${meta.avatar_url || meta.picture ? `<img src="${meta.avatar_url || meta.picture}" alt="">` : ''}
      <span>${name}</span>
      <button class="btn btn-ghost btn-sm" id="logout-btn">יציאה</button>
    </div>`;
  document.getElementById('role-select').value = State.role;
  document.getElementById('role-select').addEventListener('change', (e) => {
    State.role = e.target.value;
    buildNav();
    navigate(SCREENS_BY_ROLE[State.role][0][0]);
  });
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });
  buildNav();
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = SCREENS_BY_ROLE[State.role].map(([id, label]) => `<button data-screen="${id}">${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.addEventListener('click', () => navigate(b.dataset.screen)));
}

function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + screenId);
  if (el) el.classList.add('active');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.screen === screenId));
  // רינדור תוכן דינמי לפי המסך
  const renderers = { register: renderRegister, order: renderOrder, status: renderStatus, rides: renderRides, admin: renderAdmin, driver: renderDriver };
  if (renderers[screenId]) renderers[screenId]();
}

// ============================================================
//  4ב. נתוני ערים ורחובות — מרשם ממשלתי (data.gov.il)
//  ערים: 1,306 יישובים · רחובות: ~63,000, נטענים לפי עיר.
// ============================================================
const GOV_API = 'https://data.gov.il/api/3/action/datastore_search';
const CITIES_RESOURCE = '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba';
const STREETS_RESOURCE = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';
const AddressData = { cities: null, streetsByCity: {} };

// טעינת כל היישובים (פעם אחת, עם מטמון ב-localStorage)
async function fetchCities() {
  if (AddressData.cities) return AddressData.cities;
  try {
    const cached = localStorage.getItem('freecar_cities_v1');
    if (cached) { AddressData.cities = JSON.parse(cached); return AddressData.cities; }
  } catch { /* מטמון פגום — נטען מחדש */ }
  try {
    const url = `${GOV_API}?resource_id=${CITIES_RESOURCE}&limit=1500&fields=${encodeURIComponent('שם_ישוב,סמל_ישוב')}`;
    const d = await (await fetch(url)).json();
    const cities = (d.result.records || [])
      .map(r => ({ name: String(r['שם_ישוב'] || '').trim(), symbol: r['סמל_ישוב'] }))
      .filter(c => c.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
    AddressData.cities = cities;
    try { localStorage.setItem('freecar_cities_v1', JSON.stringify(cities)); } catch { /* מטמון מלא — לא קריטי */ }
    return cities;
  } catch { return []; }
}

// טעינת רחובות של עיר לפי סמל יישוב (מטמון בזיכרון)
async function fetchStreets(citySymbol) {
  if (AddressData.streetsByCity[citySymbol]) return AddressData.streetsByCity[citySymbol];
  try {
    const filters = encodeURIComponent(JSON.stringify({ 'סמל_ישוב': citySymbol }));
    const url = `${GOV_API}?resource_id=${STREETS_RESOURCE}&limit=5000&fields=${encodeURIComponent('שם_רחוב')}&filters=${filters}`;
    const d = await (await fetch(url)).json();
    const streets = [...new Set((d.result.records || []).map(r => String(r['שם_רחוב'] || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'he'));
    AddressData.streetsByCity[citySymbol] = streets;
    return streets;
  } catch { return []; }
}

// פקד בחירה עם חיפוש: הקלדה מסננת, לחיצה בוחרת
// provider(query) => מערך {label, value}; onPick(item) בבחירה
function setupCombo(inputEl, listEl, provider, onPick) {
  let items = [];
  async function refresh() {
    const q = inputEl.value.trim();
    items = await provider(q);
    if (!items.length) {
      listEl.innerHTML = `<div class="combo-empty">אין תוצאות${q ? ` עבור "${q}"` : ''}</div>`;
    } else {
      listEl.innerHTML = items.slice(0, 50).map((it, i) => `<div class="combo-item" data-i="${i}">${it.label}</div>`).join('');
      listEl.querySelectorAll('.combo-item').forEach(el => {
        // mousedown ולא click — כדי להקדים את ה-blur של השדה
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const it = items[+el.dataset.i];
          inputEl.value = it.label;
          listEl.classList.remove('open');
          onPick(it);
        });
      });
    }
    listEl.classList.add('open');
  }
  inputEl.addEventListener('input', refresh);
  inputEl.addEventListener('focus', refresh);
  inputEl.addEventListener('blur', () => setTimeout(() => listEl.classList.remove('open'), 150));
}

// חיבור צמד עיר+רחוב: בחירת עיר מאפסת וטוענת את הרחובות שלה
function wireAddressCombos(prefix, initialSymbol) {
  const cityInput = document.getElementById(prefix + '_city');
  const cityList = document.getElementById(prefix + '_city_list');
  const streetInput = document.getElementById(prefix + '_street');
  const streetList = document.getElementById(prefix + '_street_list');
  let citySymbol = initialSymbol || null;

  streetInput.disabled = !citySymbol;

  setupCombo(cityInput, cityList,
    async (q) => {
      const cities = await fetchCities();
      const norm = q.replace(/['"־-]/g, '');
      return cities
        .filter(c => !norm || c.name.replace(/['"־-]/g, '').includes(norm))
        .map(c => ({ label: c.name, value: c.symbol }));
    },
    (it) => {
      citySymbol = it.value;
      document.getElementById(prefix + '_city_symbol').value = it.value;
      streetInput.value = '';
      streetInput.disabled = false;
      streetInput.placeholder = 'טוען רחובות…';
      fetchStreets(citySymbol).then(s => { streetInput.placeholder = s.length ? 'הקלד/י לחיפוש רחוב…' : 'לא נמצאו רחובות — הקלד/י ידנית'; });
    });

  setupCombo(streetInput, streetList,
    async (q) => {
      if (!citySymbol) return [];
      const streets = await fetchStreets(citySymbol);
      return streets.filter(s => !q || s.includes(q)).map(s => ({ label: s, value: s }));
    },
    () => { /* הערך כבר הוזן לשדה */ });
}

// בלוק שדות כתובת: עיר (חיפוש) → רחוב (חיפוש) → מספר בית
function addressFieldsHTML(prefix, title, p) {
  const esc = s => String(s || '').replace(/"/g, '&quot;');
  return `
      <h3>${title}</h3>
      <input type="hidden" id="${prefix}_city_symbol" value="${esc(p[prefix + 'CitySymbol'])}">
      <div class="grid">
        <div class="field"><label>עיר <span class="req">*</span></label>
          <div class="combo">
            <input id="${prefix}_city" value="${esc(p[prefix + 'City'])}" placeholder="הקלד/י לחיפוש עיר…" autocomplete="off">
            <div class="combo-list" id="${prefix}_city_list"></div>
          </div>
        </div>
        <div class="field"><label>רחוב <span class="req">*</span></label>
          <div class="combo">
            <input id="${prefix}_street" value="${esc(p[prefix + 'Street'])}" placeholder="בחר/י קודם עיר" autocomplete="off">
            <div class="combo-list" id="${prefix}_street_list"></div>
          </div>
        </div>
        <div class="field"><label>מספר בית <span class="req">*</span></label><input id="${prefix}_house" value="${esc(p[prefix + 'House'])}" placeholder="לדוגמה: 12"></div>
        <div class="field"><label>מספר כניסה</label><input id="${prefix}_entrance" value="${esc(p[prefix + 'Entrance'])}" placeholder="אם יש יותר מכניסה אחת"></div>
      </div>`;
}

// ============================================================
//  5. מסך 1 — הרשמה, התחייבות ומסמכים
// ============================================================
function renderRegister() {
  const p = State.profile;
  const docs = db.where('documents', d => d.userId === p.id);
  const byType = t => docs.find(d => d.documentType === t) || {};
  const dl = byType('driver_license'), vl = byType('vehicle_license'), ins = byType('insurance');

  const blockedBanner = p.status === 'blocked'
    ? `<div class="alert err">⛔ המשתמש נחסם עקב חוסר התאמה בין רישיון הרכב לביטוח החובה (מספר רכב/דגם אינם זהים). לא ניתן להזמין הסעות.</div>` : '';
  const approvedBanner = p.status === 'approved'
    ? `<div class="alert ok">✓ המשתמש מאושר להזמנת הסעות.</div>` : '';

  document.getElementById('screen-register').innerHTML = `
    <h1 class="screen-title">הרשמה, התחייבות והעלאת מסמכים</h1>
    <p class="screen-sub">מלא/י את הפרטים והעלה/י 3 מסמכים רשמיים. המערכת תבדוק התאמה בין רישיון הרכב לביטוח החובה.</p>
    ${blockedBanner}${approvedBanner}

    <div class="card">
      <div class="checkbox-row">
        <input type="checkbox" id="commitment" ${p.commitmentApproved ? 'checked' : ''}>
        <label for="commitment">אני מתחייב/ת שכל הנתונים, הפרטים והמסמכים שהוזנו במערכת הם אמיתיים, מדויקים ועדכניים. <span class="req">*</span></label>
      </div>

      <h2>פרטים אישיים</h2>
      <div class="grid">
        <div class="field"><label>שם פרטי <span class="req">*</span></label><input id="firstName" value="${p.firstName}"></div>
        <div class="field"><label>שם משפחה <span class="req">*</span></label><input id="lastName" value="${p.lastName}"></div>
        <div class="field"><label>טלפון <span class="req">*</span></label><input id="phone" type="tel" value="${p.phone}"></div>
        <div class="field"><label>אימייל <span class="req">*</span></label><input id="email" type="email" value="${p.email}"></div>
      </div>
      ${addressFieldsHTML('home', '🏠 כתובת מגורים', p)}
      ${addressFieldsHTML('work', '💼 כתובת עבודה', p)}
    </div>

    <div class="card">
      <h2>תקנון</h2>
      <div class="alert info">תקנון (דמו): השימוש במערכת כפוף לכללי הסעה שיתופית, לתעריפים המחושבים לפי מחצית ממחיר המונה, ולתיקוף באמצעות ברקוד. בגרסה עתידית יוצג כאן קובץ תקנון שהועלה על ידי admin.</div>
      <div class="checkbox-row">
        <input type="checkbox" id="terms" ${p.termsApproved ? 'checked' : ''}>
        <label for="terms">קראתי ואני מאשר/ת את התקנון. <span class="req">*</span></label>
      </div>
    </div>

    <div class="card">
      <h2>מסמכים (אופציונלי)</h2>
      <p class="screen-sub">העלאת המסמכים אינה חובה. סמן/י מה ברשותך. ניתן גם להעלות קבצים ולהזין פרטי רכב — ואם יוזנו פרטי רכב גם ברישיון וגם בביטוח, המערכת תשווה ביניהם.</p>

      <div class="checkbox-row">
        <input type="checkbox" id="hasLicense" ${p.hasLicense ? 'checked' : ''}>
        <label for="hasLicense">יש לי רישיון נהיגה בתוקף</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="hasVehicle" ${p.hasVehicle ? 'checked' : ''}>
        <label for="hasVehicle">יש לי רכב</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="hasInsurance" ${p.hasInsurance ? 'checked' : ''}>
        <label for="hasInsurance">יש לי ביטוח חובה בתוקף</label>
      </div>

      <h3>1. רישיון נהיגה (אופציונלי)</h3>
      <div class="grid">
        <div class="field"><label>קובץ רישיון נהיגה</label><input type="file" id="file_dl" accept=".pdf,.jpg,.jpeg,.png"></div>
        <div class="field"><label>תוקף רישיון</label><input type="date" id="dl_expiry" value="${dl.expiryDate || ''}"></div>
      </div>

      <h3>2. רישיון רכב (אופציונלי)</h3>
      <div class="grid">
        <div class="field"><label>קובץ רישיון רכב</label><input type="file" id="file_vl" accept=".pdf,.jpg,.jpeg,.png"></div>
        <div class="field"><label>תוקף</label><input type="date" id="vl_expiry" value="${vl.expiryDate || ''}"></div>
        <div class="field"><label>מספר רכב (ברישיון)</label><input id="vl_number" value="${vl.vehicleNumber || ''}"></div>
        <div class="field"><label>דגם רכב (ברישיון)</label><input id="vl_model" value="${vl.vehicleModel || ''}"></div>
      </div>

      <h3>3. תעודת ביטוח חובה (אופציונלי)</h3>
      <div class="grid">
        <div class="field"><label>קובץ ביטוח חובה</label><input type="file" id="file_ins" accept=".pdf,.jpg,.jpeg,.png"></div>
        <div class="field"><label>תוקף</label><input type="date" id="ins_expiry" value="${ins.expiryDate || ''}"></div>
        <div class="field"><label>מספר רכב (בביטוח)</label><input id="ins_number" value="${ins.vehicleNumber || ''}"></div>
        <div class="field"><label>דגם רכב (בביטוח)</label><input id="ins_model" value="${ins.vehicleModel || ''}"></div>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="submit-register">שמירת הרשמה</button>
    </div>
    <div class="inline-status" id="register-status"></div>
  `;

  document.getElementById('submit-register').addEventListener('click', registerUser);

  // פקדי עיר/רחוב עם חיפוש (מרשם ממשלתי)
  wireAddressCombos('home', p.homeCitySymbol);
  wireAddressCombos('work', p.workCitySymbol);
  fetchCities();   // טעינה מוקדמת של רשימת הערים
}

// registerUser() — שמירת פרטי המשתמש + הפעלת אימות מסמכים
function registerUser() {
  const status = document.getElementById('register-status');
  const val = id => (document.getElementById(id).value || '').trim();
  const p = State.profile;

  // איסוף שדות — כתובת מורכבת מעיר + רחוב + מספר בית
  const composeAddr = (street, house, city) => `${street}${house ? ' ' + house : ''}${city ? ', ' + city : ''}`.trim();
  const data = {
    commitmentApproved: document.getElementById('commitment').checked,
    termsApproved: document.getElementById('terms').checked,
    firstName: val('firstName'), lastName: val('lastName'),
    phone: val('phone'), email: val('email'),
    homeCity: val('home_city'), homeCitySymbol: val('home_city_symbol'),
    homeStreet: val('home_street'), homeHouse: val('home_house'), homeEntrance: val('home_entrance'),
    workCity: val('work_city'), workCitySymbol: val('work_city_symbol'),
    workStreet: val('work_street'), workHouse: val('work_house'), workEntrance: val('work_entrance'),
    hasLicense: document.getElementById('hasLicense').checked,
    hasVehicle: document.getElementById('hasVehicle').checked,
    hasInsurance: document.getElementById('hasInsurance').checked,
  };
  data.homeAddress = composeAddr(data.homeStreet, data.homeHouse, data.homeCity);
  data.workAddress = composeAddr(data.workStreet, data.workHouse, data.workCity);

  // ---- ולידציות (סעיף 18) ----
  const errors = [];
  if (!data.commitmentApproved) errors.push('חובה לסמן את הצהרת ההתחייבות');
  if (!data.termsApproved) errors.push('חובה לאשר את התקנון');
  if (data.firstName.length < 2) errors.push('שם פרטי — לפחות 2 תווים');
  if (data.lastName.length < 2) errors.push('שם משפחה — לפחות 2 תווים');
  if (!/^\d{9,10}$/.test(data.phone.replace(/[-\s]/g, ''))) errors.push('מספר טלפון לא תקין');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) errors.push('כתובת אימייל לא תקינה');
  if (!data.homeCity) errors.push('חובה לבחור עיר מגורים');
  if (!data.homeStreet) errors.push('חובה לבחור רחוב מגורים');
  if (!data.homeHouse) errors.push('חובה מספר בית (מגורים)');
  if (!data.workCity) errors.push('חובה לבחור עיר עבודה');
  if (!data.workStreet) errors.push('חובה לבחור רחוב עבודה');
  if (!data.workHouse) errors.push('חובה מספר בית (עבודה)');

  // פרטי הרכב אופציונליים — נאספים אם הוזנו (לצורך השוואה רישיון מול ביטוח)
  const vlNumber = val('vl_number'), vlModel = val('vl_model');
  const insNumber = val('ins_number'), insModel = val('ins_model');

  if (errors.length) { showStatus(status, errors.join(' · '), false); return; }

  // שמירת פרטי המשתמש
  Object.assign(p, data);
  db.update('users', p.id, data);

  // שמירת/עדכון 3 המסמכים
  saveDocument('driver_license', document.getElementById('file_dl'), { expiryDate: val('dl_expiry') });
  saveDocument('vehicle_license', document.getElementById('file_vl'), { expiryDate: val('vl_expiry'), vehicleNumber: vlNumber, vehicleModel: vlModel });
  saveDocument('insurance', document.getElementById('file_ins'), { expiryDate: val('ins_expiry'), vehicleNumber: insNumber, vehicleModel: insModel });

  // ---- אימות מסמכים ----
  const result = validateUserDocuments(p.id);
  if (result.blocked) {
    blockUser(p.id, result.reason);
    showStatus(status, '⛔ ' + result.reason, false);
    setTimeout(() => renderRegister(), 400);
  } else {
    db.update('users', p.id, { status: 'approved' });
    State.profile.status = 'approved';
    // מעבר ישיר להזמנת נסיעה: מקור = בית, יעד = עבודה
    showStatus(status, '✓ הפרטים נשמרו! עוברים להזמנת נסיעה…', true);
    setTimeout(() => navigate('order'), 700);
  }
}

// שמירת מסמך (בדמו נשמר שם הקובץ בלבד, לא התוכן)
function saveDocument(type, fileInput, extra) {
  const p = State.profile;
  const existing = db.where('documents', d => d.userId === p.id && d.documentType === type)[0];
  const fileName = (fileInput && fileInput.files[0]) ? fileInput.files[0].name : (existing ? existing.fileName : '');
  const rec = {
    id: existing ? existing.id : uid(),
    userId: p.id, documentType: type, fileName,
    fileUrl: '', validationStatus: 'pending', rejectionReason: '',
    ...extra,
  };
  if (existing) db.update('documents', existing.id, rec); else db.insert('documents', rec);
}

// validateUserDocuments() — השוואת מספר ודגם רכב בין רישיון הרכב לביטוח (סעיף 5.2 / 16.1)
function validateUserDocuments(userId) {
  const docs = db.where('documents', d => d.userId === userId);
  const vl = docs.find(d => d.documentType === 'vehicle_license');
  const ins = docs.find(d => d.documentType === 'insurance');
  if (!vl || !ins) return { blocked: false };

  const norm = s => (s || '').replace(/[-\s]/g, '').toLowerCase();
  // ההשוואה רצה רק אם הוזנו פרטי רכב גם ברישיון וגם בביטוח (אחרת אין מה להשוות)
  if (!norm(vl.vehicleNumber) || !norm(ins.vehicleNumber)) return { blocked: false };
  if (norm(vl.vehicleNumber) !== norm(ins.vehicleNumber))
    return { blocked: true, reason: 'מספר הרכב ברישיון אינו זהה למספר הרכב בביטוח החובה' };
  if (norm(vl.vehicleModel) !== norm(ins.vehicleModel))
    return { blocked: true, reason: 'דגם הרכב ברישיון אינו זהה לדגם בביטוח החובה' };
  return { blocked: false };
}

// blockUser() — חסימת משתמש
function blockUser(userId, reason) {
  db.update('users', userId, { status: 'blocked' });
  if (State.profile.id === userId) State.profile.status = 'blocked';
  db.where('documents', d => d.userId === userId).forEach(d => db.update('documents', d.id, { validationStatus: 'rejected', rejectionReason: reason }));
}

// ============================================================
//  6. מסך 2 — הזמנת הסעה
// ============================================================
function renderOrder() {
  const p = State.profile;
  if (p.status !== 'approved') {
    document.getElementById('screen-order').innerHTML = `
      <h1 class="screen-title">הזמנת הסעה</h1>
      <div class="alert warn">כדי להזמין הסעה יש להשלים הרשמה ולעבור אימות מסמכים. עבור/י למסך "הרשמה ומסמכים".</div>`;
    return;
  }

  const timeOptions = generateTimeOptions().map(t => `<option value="${t}">${t}</option>`).join('');
  const myRides = db.where('rideRequests', r => r.userId === p.id);

  const home = p.homeAddress || '';
  const work = p.workAddress || '';
  const esc = s => String(s || '').replace(/"/g, '&quot;');

  document.getElementById('screen-order').innerHTML = `
    <h1 class="screen-title">הזמנת נסיעה</h1>
    <p class="screen-sub">מקור = כתובת המגורים · יעד = כתובת העבודה. ניתן לערוך את שניהם, להחליף ביניהם, או לבחור יעד במפה.</p>

    <div class="card">
      <h2>בקשה חדשה</h2>
      <div class="order-layout">
        <!-- טופס (ימין) -->
        <div class="order-form">
          <div class="grid">
            <div class="field"><label>תאריך <span class="req">*</span></label><input type="date" id="o_date"><small id="hebrew-preview" style="color:var(--muted)"></small></div>
            <div class="field"><label>שעת איסוף <span class="req">*</span></label><select id="o_time">${timeOptions}</select></div>
          </div>

          <div class="field"><label>🟢 כתובת מקור <span class="req">*</span></label><input id="o_pickup" value="${esc(home)}" placeholder="ברירת מחדל: כתובת המגורים שלך"></div>

          <div style="text-align:center;margin:2px 0 10px">
            <button class="btn btn-ghost btn-sm" id="swap-btn" title="החלפת מקור ויעד">⇅ החלפת מקור ויעד</button>
          </div>

          <h3>🔴 יעד</h3>
          <div class="grid">
            <div class="field"><label>עיר</label><input id="d_city" placeholder="לדוגמה: תל אביב"></div>
            <div class="field"><label>רחוב</label><input id="d_street" placeholder="לדוגמה: אלנבי"></div>
            <div class="field"><label>מספר בית</label><input id="d_house" placeholder="לדוגמה: 12"></div>
            <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-ghost btn-sm" id="d_search" style="width:100%">🔎 חפש/י על המפה</button></div>
          </div>
          <div class="field"><label>כתובת יעד מלאה <span class="req">*</span></label><input id="o_dest" value="${esc(work)}" placeholder="ברירת מחדל: כתובת העבודה שלך"></div>
          <div class="geo-status" id="geo-status"></div>

          <div class="grid">
            <div class="field"><label>מספר נוסעים (כולל אותך) <span class="req">*</span></label><input type="number" id="o_pax" min="1" value="1"></div>
            <div class="field"><label>סכום לתשלום</label><input id="o_total" readonly value="יחושב לאחר שהנהג יזין מחיר מונה"></div>
          </div>

          <div class="btn-row"><button class="btn btn-primary" id="submit-order">שליחת בקשה</button></div>
          <div class="inline-status" id="order-status"></div>
        </div>

        <!-- מפה (שמאל) -->
        <div class="order-map-wrap">
          <div id="order-map" class="order-map"></div>
          <div class="map-legend">🟢 מקור (כתובתך) · 🔴 יעד — לחיצה על המפה מציבה את היעד וממלאת את הכתובת</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>הבקשות שלי (${myRides.length})</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>תאריך (לועזי + עברי + יום)</th><th>שעה</th><th>איסוף</th><th>יעד</th><th>נוסעים</th><th>סכום</th></tr></thead>
          <tbody>${myRides.length ? myRides.map(rideRowOrder).join('') : `<tr><td class="empty" colspan="6">אין בקשות עדיין</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  const dateEl = document.getElementById('o_date');
  dateEl.min = new Date().toISOString().split('T')[0];   // תאריך עתידי בלבד
  dateEl.addEventListener('change', () => {
    if (dateEl.value) document.getElementById('hebrew-preview').textContent = `${generateHebrewDate(dateEl.value)} · ${getWeekday(dateEl.value)}`;
  });
  document.getElementById('d_search').addEventListener('click', searchDestinationOnMap);
  document.getElementById('submit-order').addEventListener('click', createRideRequest);
  document.getElementById('swap-btn').addEventListener('click', swapOriginDest);
  // עריכה ידנית של כתובת → עדכון הסמן במפה
  document.getElementById('o_pickup').addEventListener('change', () => geocodeOrigin(document.getElementById('o_pickup').value.trim()));
  document.getElementById('o_dest').addEventListener('change', () => geocodeDest(document.getElementById('o_dest').value.trim()));

  initOrderMap();   // אתחול המפה לאחר שה-DOM מוכן
}

// swapOriginDest() — החלפת מקור ↔ יעד (כתובות + סמנים במפה)
function swapOriginDest() {
  const pi = document.getElementById('o_pickup'), di = document.getElementById('o_dest');
  [pi.value, di.value] = [di.value, pi.value];

  // החלפת הקואורדינטות והצבת הסמנים מחדש
  const oc = MapState.originCoords, dc = MapState.destCoords;
  placeOrClear('origin', dc);
  placeOrClear('dest', oc);
  fitMapToMarkers();

  // שדות חיפוש היעד כבר לא רלוונטיים לכתובת החדשה — ניקוי
  ['d_city', 'd_street', 'd_house'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const geo = document.getElementById('geo-status');
  if (geo) geo.textContent = '⇅ המקור והיעד הוחלפו.';
}

// הצבת סמן לפי קואורדינטות, או הסרתו אם אין
function placeOrClear(kind, coords) {
  const markerKey = kind === 'origin' ? 'originMarker' : 'destMarker';
  const coordsKey = kind === 'origin' ? 'originCoords' : 'destCoords';
  if (coords) {
    kind === 'origin' ? setOriginMarker(coords.lat, coords.lng) : setDestMarker(coords.lat, coords.lng);
  } else {
    if (MapState[markerKey] && MapState.map) MapState.map.removeLayer(MapState[markerKey]);
    MapState[markerKey] = null;
    MapState[coordsKey] = null;
  }
}

// ============================================================
//  מפה + Geocoding (Leaflet + OpenStreetMap / Nominatim)
//  בעתיד ניתן להחליף ל-Google Maps API ללא שינוי בשאר הקוד.
// ============================================================
const MapState = { map: null, originMarker: null, destMarker: null, originCoords: null, destCoords: null };

function mapPin(emoji) {
  return window.L.divIcon({ html: `<div class="map-pin">${emoji}</div>`, className: '', iconSize: [26, 26], iconAnchor: [13, 24] });
}

function initOrderMap() {
  const L = window.L;
  const box = document.getElementById('order-map');
  if (!L || !box) { if (box) box.innerHTML = '<div class="alert err" style="margin:12px">טעינת המפה נכשלה (Leaflet לא נטען — בדוק/י חיבור אינטרנט).</div>'; return; }

  if (MapState.map) { MapState.map.remove(); MapState.map = null; }
  MapState.originMarker = MapState.destMarker = MapState.originCoords = MapState.destCoords = null;

  const map = L.map('order-map').setView([31.4, 35.0], 7);   // מרכז ישראל
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  MapState.map = map;

  // לחיצה על המפה → הצבת יעד + מילוי כתובת (reverse geocoding)
  map.on('click', (e) => {
    setDestMarker(e.latlng.lat, e.latlng.lng);
    reverseFillDestination(e.latlng.lat, e.latlng.lng);
  });

  // הצגת המקור והיעד על המפה (מקור = בית, יעד = עבודה — או מה שבשדות)
  const pickupVal = (document.getElementById('o_pickup') || {}).value || '';
  const destVal = (document.getElementById('o_dest') || {}).value || '';
  if (pickupVal.trim()) geocodeOrigin(pickupVal.trim());
  // השהיה קלה בין שתי בקשות geocoding (מגבלת Nominatim ~1 לשנייה)
  if (destVal.trim()) setTimeout(() => geocodeDest(destVal.trim()), 1100);

  setTimeout(() => map.invalidateSize(), 200);   // תיקון תצוגה כשהמסך נטען
}

// התאמת תצוגת המפה לסמנים הקיימים
function fitMapToMarkers() {
  if (!MapState.map) return;
  const pts = [];
  if (MapState.originCoords) pts.push([MapState.originCoords.lat, MapState.originCoords.lng]);
  if (MapState.destCoords) pts.push([MapState.destCoords.lat, MapState.destCoords.lng]);
  if (pts.length === 2) MapState.map.fitBounds(pts, { padding: [50, 50] });
  else if (pts.length === 1) MapState.map.setView(pts[0], 13);
}

function setOriginMarker(lat, lng) {
  const L = window.L;
  if (MapState.originMarker) MapState.originMarker.setLatLng([lat, lng]);
  else MapState.originMarker = L.marker([lat, lng], { icon: mapPin('🟢'), title: 'מקור' }).addTo(MapState.map);
  MapState.originCoords = { lat, lng };
}

function setDestMarker(lat, lng) {
  const L = window.L;
  if (MapState.destMarker) MapState.destMarker.setLatLng([lat, lng]);
  else MapState.destMarker = L.marker([lat, lng], { icon: mapPin('🔴'), title: 'יעד' }).addTo(MapState.map);
  MapState.destCoords = { lat, lng };
}

// geocode() — כתובת → קואורדינטות (Nominatim, מוגבל לישראל)
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&accept-language=he&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const arr = await res.json();
    return arr[0] ? { lat: +arr[0].lat, lng: +arr[0].lon, label: arr[0].display_name } : null;
  } catch { return null; }
}

// reverseGeocode() — קואורדינטות → כתובת
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=he&lat=${lat}&lon=${lng}`;
  try { return await (await fetch(url)).json(); } catch { return null; }
}

async function geocodeOrigin(address) {
  if (!address) return;
  const geo = document.getElementById('geo-status');
  const r = await geocode(address);
  if (!r) { if (geo) geo.textContent = 'לא ניתן היה לאתר את כתובת המקור על המפה.'; return; }
  setOriginMarker(r.lat, r.lng);
  fitMapToMarkers();
}

// geocodeDest() — איתור כתובת היעד על המפה
async function geocodeDest(address) {
  if (!address) return;
  const geo = document.getElementById('geo-status');
  const r = await geocode(address);
  if (!r) { if (geo) geo.textContent = 'לא ניתן היה לאתר את כתובת היעד על המפה.'; return; }
  setDestMarker(r.lat, r.lng);
  fitMapToMarkers();
}

// חיפוש יעד לפי עיר/רחוב/מספר בית → עדכון המפה
async function searchDestinationOnMap() {
  const geo = document.getElementById('geo-status');
  const v = id => document.getElementById(id).value.trim();
  const city = v('d_city'), street = v('d_street'), house = v('d_house');
  if (!city && !street) { geo.textContent = 'הזן/י לפחות עיר או רחוב לחיפוש.'; return; }
  geo.textContent = 'מחפש/ת…';
  const r = await geocode(`${street} ${house}, ${city}, ישראל`);
  if (!r) { geo.textContent = '✗ לא נמצאה כתובת תואמת. נסה/י לדייק או לבחור נקודה על המפה.'; return; }
  setDestMarker(r.lat, r.lng);
  MapState.map.setView([r.lat, r.lng], 15);
  document.getElementById('o_dest').value = `${street}${house ? ' ' + house : ''}${city ? ', ' + city : ''}`.trim();
  geo.textContent = '✓ היעד סומן על המפה.';
}

// מילוי כתובת היעד מלחיצה על המפה (reverse geocoding)
async function reverseFillDestination(lat, lng) {
  const geo = document.getElementById('geo-status');
  geo.textContent = 'מזהה כתובת…';
  const j = await reverseGeocode(lat, lng);
  const a = (j && j.address) || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  const street = a.road || '';
  const house = a.house_number || '';
  document.getElementById('d_city').value = city;
  document.getElementById('d_street').value = street;
  document.getElementById('d_house').value = house;
  const composed = `${street}${house ? ' ' + house : ''}${city ? ', ' + city : ''}`.trim();
  document.getElementById('o_dest').value = composed || (j && j.display_name) || `נקודה על המפה (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  geo.textContent = '✓ היעד נבחר מהמפה.';
}

function rideRowOrder(r) {
  return `<tr>
    <td>${r.gregorianDate}<br><small style="color:var(--muted)">${r.hebrewDate} · ${r.weekday}</small></td>
    <td>${r.pickupTime}</td><td>${r.pickupAddress}</td><td>${r.destinationAddress}</td>
    <td>${r.passengersCount}</td>
    <td>${r.totalPrice ? r.totalPrice + ' ₪' : '<span class="badge unpaid">ממתין למחיר נהג</span>'}</td>
  </tr>`;
}

// generateTimeOptions() — שעות במרווחי 15 דקות (סעיף 16.3)
function generateTimeOptions() {
  const times = [];
  for (let hour = 0; hour < 24; hour++)
    for (const minute of [0, 15, 30, 45])
      times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  return times;
}

// generateHebrewDate() — תאריך עברי (סעיף 15)
function generateHebrewDate(dateStr) {
  try {
    return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateStr + 'T00:00:00'));
  } catch { return ''; }
}
function getWeekday(dateStr) {
  try { return new Intl.DateTimeFormat('he', { weekday: 'long' }).format(new Date(dateStr + 'T00:00:00')); }
  catch { return ''; }
}

// createRideRequest() — יצירת בקשת הסעה
function createRideRequest() {
  const status = document.getElementById('order-status');
  const val = id => document.getElementById(id).value.trim();
  const date = val('o_date'), time = document.getElementById('o_time').value;
  const pickup = val('o_pickup'), dest = val('o_dest');
  const pax = parseInt(document.getElementById('o_pax').value, 10);

  const errors = [];
  if (!date) errors.push('חובה לבחור תאריך');
  else if (new Date(date + 'T' + time) <= new Date()) errors.push('יש לבחור תאריך/שעה עתידיים');
  if (!pickup) errors.push('חובה כתובת איסוף');
  if (!dest) errors.push('חובה כתובת יעד');
  if (!pax || pax < 1) errors.push('מספר נוסעים חייב להיות לפחות 1');
  if (errors.length) { showStatus(status, errors.join(' · '), false); return; }

  const ride = {
    id: uid(), userId: State.profile.id,
    gregorianDate: date, hebrewDate: generateHebrewDate(date), weekday: getWeekday(date),
    pickupTime: time, pickupAddress: pickup, pickupEntrance: '',
    destinationAddress: dest, destinationEntrance: '',
    pickupCoords: MapState.originCoords, destinationCoords: MapState.destCoords,
    passengersCount: pax,
    fullMeterPrice: null, halfPricePerPassenger: null, totalPrice: null,
    status: 'pending', paymentStatus: 'unpaid', barcode: null,
    rejectionReason: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.insert('rideRequests', ride);
  showStatus(status, '✓ הבקשה נשלחה וממתינה לטיפול (סטטוס: בטיפול).', true);
  setTimeout(renderOrder, 500);
}

// ============================================================
//  7. חישובי מחיר (סעיף 6.4 / 16.2)
// ============================================================
function calculateHalfPrice(fullMeterPrice) { return fullMeterPrice / 2; }
function calculateTotalRidePrice(fullMeterPrice, passengersCount) {
  const halfPricePerPassenger = calculateHalfPrice(fullMeterPrice);
  return { halfPricePerPassenger, totalPrice: halfPricePerPassenger * passengersCount };
}

// ============================================================
//  8. לוגיקת התאמת מסלולים (סעיף 7)
// ============================================================
// calculateRouteOverlap() — אחוז חפיפה 0..100 (דמו: דמיון טקסטואלי בין כתובות)
function calculateRouteOverlap(routeA, routeB) {
  const tokens = s => (s || '').toLowerCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  const setA = new Set([...tokens(routeA.pickup), ...tokens(routeA.destination)]);
  const setB = new Set([...tokens(routeB.pickup), ...tokens(routeB.destination)]);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  setA.forEach(t => { if (setB.has(t)) inter++; });
  const union = new Set([...setA, ...setB]).size;
  return Math.round((inter / union) * 100);
}

// findMatchingRides() — מציאת בקשות שיכולות לחלוק הסעה (סעיף 7.1)
function findMatchingRides(ride, all = db.all('rideRequests')) {
  return all.filter(other => {
    if (other.id === ride.id || other.userId === ride.userId) return false;
    if (other.gregorianDate !== ride.gregorianDate) return false;                  // אותו תאריך
    if (!isTimeCompatible(ride.pickupTime, other.pickupTime)) return false;        // שעה תואמת (±30 ד')
    const overlap = calculateRouteOverlap(
      { pickup: ride.pickupAddress, destination: ride.destinationAddress },
      { pickup: other.pickupAddress, destination: other.destinationAddress });
    if (overlap < ROUTE_OVERLAP_MIN) return false;                                 // חפיפה >= 40%
    return true;
  }).map(other => {
    const overlap = calculateRouteOverlap(
      { pickup: ride.pickupAddress, destination: ride.destinationAddress },
      { pickup: other.pickupAddress, destination: other.destinationAddress });
    return { ride: other, overlap, pickupOffsetMinutes: estimatePickupOffset(overlap) };
  });
}

function isTimeCompatible(t1, t2) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return Math.abs(toMin(t1) - toMin(t2)) <= 30;
}

// התאמת שעת איסוף לפי מיקום במסלול (סעיף 7.4) — דמו
function estimatePickupOffset(overlapPercent) {
  const position = Math.max(0, 100 - overlapPercent);      // ככל שהחפיפה נמוכה, המיקום "רחוק" יותר
  return Math.min(30, Math.round(position / 10) * 5);      // 0..30 דקות במרווחי 5
}

// ============================================================
//  9. מסך 3 — סטטוס בקשות
// ============================================================
const STATUS_LABEL = {
  approved: 'הבקשה מאושרת',
  rejected: 'הבקשה נדחתה',
  pending: 'הבקשה בטיפול. עדכון סופי יתקבל עד 48 שעות לפני שעת האיסוף',
};

function renderStatus() {
  const rides = db.where('rideRequests', r => r.userId === State.profile.id);
  document.getElementById('screen-status').innerHTML = `
    <h1 class="screen-title">מצב הטיפול בבקשות</h1>
    <p class="screen-sub">מעקב אחר כל בקשות ההסעה שהזמנת.</p>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>תאריך איסוף</th><th>שעה</th><th>כתובת איסוף</th><th>כתובת יעד</th><th>מצב הטיפול</th></tr></thead>
      <tbody>${rides.length ? rides.map(r => `
        <tr>
          <td>${r.gregorianDate}<br><small style="color:var(--muted)">${r.weekday}</small></td>
          <td>${r.pickupTime}</td><td>${r.pickupAddress}</td><td>${r.destinationAddress}</td>
          <td><span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span>${r.rejectionReason ? `<br><small style="color:var(--muted)">${r.rejectionReason}</small>` : ''}</td>
        </tr>`).join('') : `<tr><td class="empty" colspan="5">אין בקשות</td></tr>`}
      </tbody>
    </table></div></div>`;
}

// ============================================================
//  10. מסך 4 — הסעות מאושרות / בטיפול / נדחו + תשלום + ברקוד
// ============================================================
function renderRides() {
  const mine = db.where('rideRequests', r => r.userId === State.profile.id);
  const approved = mine.filter(r => r.status === 'approved');
  const pending = mine.filter(r => r.status === 'pending');
  const rejected = mine.filter(r => r.status === 'rejected');

  document.getElementById('screen-rides').innerHTML = `
    <h1 class="screen-title">ההסעות שלי</h1>
    <p class="screen-sub">מאושרות (תשלום + ברקוד), בטיפול (הצעות שינוי) ונדחו. טבלת המאושרות מתעדכנת אוטומטית כל דקה.</p>

    <div class="card">
      <h2>הסעות מאושרות (${approved.length})</h2>
      <div class="table-wrap" id="approved-table">${approvedTableHTML(approved)}</div>
    </div>

    <div class="card">
      <h2>בקשות בטיפול (${pending.length})</h2>
      ${pending.length ? pending.map(pendingCardHTML).join('') : '<div class="alert info">אין בקשות בטיפול.</div>'}
    </div>

    <div class="card">
      <h2>בקשות שנדחו (${rejected.length})</h2>
      ${rejected.length ? rejected.map(rejectedCardHTML).join('') : '<div class="alert info">אין בקשות שנדחו.</div>'}
    </div>`;

  wireRidesEvents();
}

function approvedTableHTML(approved) {
  return `<table>
    <thead><tr><th>תאריך</th><th>שעה</th><th>איסוף</th><th>יעד</th><th>נוסעים</th><th>סכום</th><th>תשלום</th><th>פעולה</th></tr></thead>
    <tbody>${approved.length ? approved.map(r => `
      <tr>
        <td>${r.gregorianDate}</td><td>${r.pickupTime}</td><td>${r.pickupAddress}</td><td>${r.destinationAddress}</td>
        <td>${r.passengersCount}</td><td>${r.totalPrice ? r.totalPrice + ' ₪' : '—'}</td>
        <td><span class="badge ${r.paymentStatus}">${r.paymentStatus === 'paid' ? 'שולם' : 'לא שולם'}</span></td>
        <td>${r.paymentStatus === 'paid'
            ? `<button class="btn btn-green btn-sm" data-qr="${r.id}">הצג ברקוד</button>`
            : (r.totalPrice ? `<button class="btn btn-primary btn-sm" data-pay="${r.id}">לתשלום</button>` : '<small style="color:var(--muted)">ממתין למחיר נהג</small>')}</td>
      </tr>`).join('') : `<tr><td class="empty" colspan="8">אין הסעות מאושרות</td></tr>`}
    </tbody></table>`;
}

function pendingCardHTML(r) {
  const offers = db.where('offers', o => o.rideRequestId === r.id && o.userResponse === 'pending');
  return `<div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">
    <b>${r.gregorianDate} · ${r.pickupTime}</b> — ${r.pickupAddress} ← ${r.destinationAddress}
    <div style="margin-top:8px">
    ${offers.length ? offers.map(offerHTML).join('') : `<div class="alert info" style="margin:0">הבקשה בטיפול — ממתינה להתאמה. הצעת שינוי תישלח כעבור ${OFFER_AFTER_DAYS} ימים אם לא תימצא התאמה.</div>`}
    </div>
  </div>`;
}

function offerHTML(o) {
  const typeText = {
    change_date: `שינוי מועד ל-${o.newDate}`,
    change_time: `שינוי שעה ל-${o.newTime}`,
    change_pickup: `שינוי כתובת איסוף ל: ${o.newPickupAddress}`,
    taxi_full_price: `מונית ספיישל בתעריף מלא (${o.taxiFullPrice} ₪)`,
    scooter: `קורקינט לכתובת המקורית + הגעה לכתובת חדשה`,
  }[o.offerType] || o.offerType;

  let extra = '';
  if (o.offerType === 'change_pickup') {
    extra = `<div class="alert info" style="margin-top:8px">
      <b>בחר/י דרך הגעה לכתובת האיסוף החדשה:</b>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" data-scooter="${o.id}">🛴 הזמנת קורקינט (סיסמה)</button>
        <button class="btn btn-ghost btn-sm" data-taxi="${o.id}">🚕 מונית ספיישל בתעריף מלא</button>
      </div></div>`;
  }
  return `<div class="alert warn">
    <b>נמצאה אפשרות לשלב אותך בהסעה:</b> ${typeText}.
    <div class="btn-row">
      <button class="btn btn-green btn-sm" data-accept="${o.id}">אישור ההצעה</button>
      <button class="btn btn-red btn-sm" data-decline="${o.id}">דחיית ההצעה</button>
    </div>${extra}
  </div>`;
}

function rejectedCardHTML(r) {
  const offer = db.where('offers', o => o.rideRequestId === r.id)[0];
  return `<div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">
    <b>${r.gregorianDate} · ${r.pickupTime}</b> — ${r.pickupAddress} ← ${r.destinationAddress}
    <div class="alert err" style="margin-top:8px">בקשת ההסעה נדחתה. ${r.rejectionReason || ''} ניתן לאשר מחדש בכפוף לשינוי פרטי האיסוף, או להזמין מונית ספיישל בתעריף מלא.</div>
    <div class="btn-row">
      ${offer && offer.newPickupAddress ? `<button class="btn btn-green btn-sm" data-accept="${offer.id}">אישור כתובת איסוף מוצעת</button>` : ''}
      <button class="btn btn-orange btn-sm" data-special="${r.id}">הזמנת מונית ספיישל (תעריף מלא)</button>
    </div>
  </div>`;
}

function wireRidesEvents() {
  const q = sel => document.querySelectorAll(sel);
  q('[data-pay]').forEach(b => b.addEventListener('click', () => openPaymentModal(b.dataset.pay)));
  q('[data-qr]').forEach(b => b.addEventListener('click', () => openBarcodeModal(b.dataset.qr)));
  q('[data-accept]').forEach(b => b.addEventListener('click', () => acceptOffer(b.dataset.accept)));
  q('[data-decline]').forEach(b => b.addEventListener('click', () => rejectOffer(b.dataset.decline)));
  q('[data-scooter]').forEach(b => b.addEventListener('click', () => offerScooter(b.dataset.scooter)));
  q('[data-taxi]').forEach(b => b.addEventListener('click', () => {
    const o = db.find('offers', b.dataset.taxi);
    if (o) { db.update('offers', o.id, { userResponse: 'accepted' }); orderSpecialTaxi(o.rideRequestId); }
  }));
  q('[data-special]').forEach(b => b.addEventListener('click', () => orderSpecialTaxi(b.dataset.special)));
}

// refreshApprovedRidesTable() — רענון אוטומטי (סעיף 9.3)
function refreshApprovedRidesTable() {
  const el = document.getElementById('approved-table');
  if (el && document.getElementById('screen-rides').classList.contains('active')) {
    const approved = db.where('rideRequests', r => r.userId === State.profile.id && r.status === 'approved');
    el.innerHTML = approvedTableHTML(approved);
    wireRidesEvents();
  }
}

// acceptOffer() — אישור הצעת שינוי → עדכון בקשה → מעבר לתשלום (סעיף 9.6)
function acceptOffer(offerId) {
  const offer = db.find('offers', offerId);
  if (!offer) return;
  const ride = db.find('rideRequests', offer.rideRequestId);
  const patch = { status: 'approved', rejectionReason: '' };
  if (offer.newDate) { patch.gregorianDate = offer.newDate; patch.hebrewDate = generateHebrewDate(offer.newDate); patch.weekday = getWeekday(offer.newDate); }
  if (offer.newTime) patch.pickupTime = offer.newTime;
  if (offer.newPickupAddress) patch.pickupAddress = offer.newPickupAddress;
  // מונית ספיישל בתעריף מלא — תעריף מלא אחד (לא מוכפל במספר נוסעים)
  if (offer.taxiFullPrice) { patch.fullMeterPrice = offer.taxiFullPrice; patch.totalPrice = offer.taxiFullPrice; patch.halfPricePerPassenger = null; }
  db.update('rideRequests', ride.id, patch);
  db.update('offers', offerId, { userResponse: 'accepted' });
  alert('ההצעה אושרה. הבקשה עודכנה לסטטוס "מאושרת". ניתן לעבור לתשלום במסך ההסעות המאושרות.');
  renderRides();
}

// rejectOffer() — דחיית הצעה
function rejectOffer(offerId) {
  db.update('offers', offerId, { userResponse: 'declined' });
  renderRides();
}

// הצעת קורקינט + סיסמה (סעיף 9.7 אפשרות 1)
function offerScooter(offerId) {
  const offer = db.find('offers', offerId);
  const code = 'SCOOTER-' + Math.floor(1000 + Math.random() * 9000);
  db.update('offers', offerId, { scooterCode: code });
  alert(`הוזמן קורקינט לכתובת האיסוף המקורית.\nסיסמה לשימוש בקורקינט: ${code}\nיש להגיע לכתובת החדשה: ${offer.newPickupAddress}\nרק בעל/ת הסיסמה יכול/ה להשתמש בקורקינט.`);
}

// הזמנת מונית ספיישל בתעריף מלא (סעיף 9.8)
function orderSpecialTaxi(rideId) {
  const full = prompt('הזמנת מונית ספיישל בתעריף מלא. הזן/י את מחיר המונה המלא (₪):', '100');
  if (full === null) return;
  const price = Number(full);
  if (!price || price <= 0) { alert('יש להזין מחיר חיובי.'); return; }
  // תעריף מלא — תשלום מלא אחד על ידי המשתמש
  db.update('rideRequests', rideId, { status: 'approved', fullMeterPrice: price, halfPricePerPassenger: null, totalPrice: price, rejectionReason: '' });
  alert('מונית ספיישל הוזמנה בתעריף מלא. ניתן לעבור לתשלום.');
  renderRides();
}

// ============================================================
//  11. תשלום + ברקוד (סעיף 10)
// ============================================================
function openPaymentModal(rideId) {
  const ride = db.find('rideRequests', rideId);
  openModal(`
    <span class="close-x" data-close>×</span>
    <h2>תשלום עבור הסעה</h2>
    <div class="alert info">סכום לתשלום: <b>${ride.totalPrice} ₪</b>${ride.halfPricePerPassenger ? ` (${ride.passengersCount} נוסעים × ${ride.halfPricePerPassenger} ₪)` : ' (תעריף מלא)'}</div>
    <div class="field"><label>שם בעל הכרטיס <span class="req">*</span></label><input id="pay_name"></div>
    <div class="field"><label>4 ספרות אחרונות <span class="req">*</span></label><input id="pay_last4" maxlength="4" placeholder="****"></div>
    <div class="field"><label>תוקף <span class="req">*</span></label><input id="pay_exp" placeholder="MM/YY"></div>
    <div class="checkbox-row"><input type="checkbox" id="pay_terms"><label for="pay_terms">אני מאשר/ת את תנאי התשלום <span class="req">*</span></label></div>
    <div class="alert warn" style="font-size:12px">בדמו לא נשמרים מספר כרטיס מלא, CVV או נתוני אשראי רגישים.</div>
    <button class="btn btn-primary" id="do-pay" style="width:100%">שלם/י ${ride.totalPrice} ₪</button>
    <div class="inline-status" id="pay-status"></div>
  `);
  document.getElementById('do-pay').addEventListener('click', () => simulatePayment(rideId));
}

// simulatePayment() — דימוי סליקה (סעיף 10.1)
function simulatePayment(rideId) {
  const ride = db.find('rideRequests', rideId);
  const status = document.getElementById('pay-status');
  const name = document.getElementById('pay_name').value.trim();
  const last4 = document.getElementById('pay_last4').value.trim();
  const exp = document.getElementById('pay_exp').value.trim();
  if (!name || !/^\d{4}$/.test(last4) || !exp || !document.getElementById('pay_terms').checked) {
    showStatus(status, 'יש למלא את כל שדות התשלום ולאשר את התנאים', false); return;
  }
  showStatus(status, 'מבצע סליקה…', true);
  setTimeout(() => {
    // דימוי אישור חברת אשראי
    db.insert('payments', {
      id: uid(), userId: State.profile.id, rideRequestId: rideId,
      amount: ride.totalPrice, paymentStatus: 'approved', lastFourDigits: last4, paymentDate: new Date().toISOString(),
    });
    const barcode = generateBarcode(rideId);
    db.update('rideRequests', rideId, { paymentStatus: 'paid', barcode });
    closeModal();
    openBarcodeModal(rideId);
    renderRides();
  }, 800);
}

// generateBarcode() — יצירת קוד תיקוף ייחודי (סעיף 10.3)
function generateBarcode(rideId) {
  const counter = (parseInt(localStorage.getItem('freecar_rideCounter') || '0', 10) + 1);
  localStorage.setItem('freecar_rideCounter', String(counter));
  const year = new Date().getFullYear();
  const seq = String(counter).padStart(6, '0');
  const userSeq = State.profile.id.replace(/\D/g, '').slice(0, 3) || Math.floor(Math.random() * 900 + 100);
  return `RIDE-${year}-${seq}-USER-${userSeq}`;
}

function openBarcodeModal(rideId) {
  const ride = db.find('rideRequests', rideId);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(ride.barcode)}`;
  openModal(`
    <span class="close-x" data-close>×</span>
    <h2>ברקוד לתיקוף מול הנהג</h2>
    <div class="alert ok">התשלום אושר ✓ הצג/י את הקוד לנהג ההסעה.</div>
    <div class="qr-box">
      <img src="${qrUrl}" alt="QR" width="200" height="200">
      <div class="qr-code-text">${ride.barcode}</div>
    </div>
  `);
}

// ============================================================
//  12. מסך 5 — Admin
// ============================================================
function renderAdmin() {
  const users = db.all('users');
  const rides = db.all('rideRequests');

  document.getElementById('screen-admin').innerHTML = `
    <h1 class="screen-title">מסך ניהול (Admin)</h1>
    <p class="screen-sub">ניהול משתמשים, בקשות והתאמות פוטנציאליות בין נוסעים.</p>

    <div class="card">
      <h2>קאונטר התאמות לפי תאריך · שעה · מסלול</h2>
      <div class="counter-grid" id="match-counters">${matchCountersHTML(rides)}</div>
    </div>

    <div class="card">
      <h2>משתמשים (${users.length})</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>שם מלא</th><th>טלפון</th><th>אימייל</th><th>מגורים</th><th>עבודה</th><th>סטטוס מסמכים</th><th>סטטוס</th><th>פעולה</th></tr></thead>
        <tbody>${users.map(adminUserRow).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>בקשות הסעה (${rides.length})</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>מזהה</th><th>משתמש</th><th>תאריך</th><th>שעה</th><th>איסוף</th><th>יעד</th><th>נוסעים</th><th>חפיפה / תואמים</th><th>סטטוס</th><th>פעולה</th></tr></thead>
        <tbody>${rides.length ? rides.map(adminRideRow).join('') : `<tr><td class="empty" colspan="10">אין בקשות</td></tr>`}</tbody>
      </table></div>
    </div>`;

  wireAdminEvents();
}

function matchCountersHTML(rides) {
  const pendingApproved = rides.filter(r => r.status === 'pending' || r.status === 'approved');
  const groups = {};
  pendingApproved.forEach(r => {
    const key = `${r.gregorianDate}|${r.pickupTime}|${extractCity(r.pickupAddress)}→${extractCity(r.destinationAddress)}`;
    (groups[key] = groups[key] || []).push(r);
  });
  const cards = Object.entries(groups).filter(([, arr]) => arr.length >= 2).map(([key, arr]) => {
    const [date, time, route] = key.split('|');
    let sum = 0, cnt = 0;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      sum += calculateRouteOverlap({ pickup: arr[i].pickupAddress, destination: arr[i].destinationAddress }, { pickup: arr[j].pickupAddress, destination: arr[j].destinationAddress }); cnt++;
    }
    const avg = cnt ? Math.round(sum / cnt) : 0;
    return `<div class="counter-card"><div class="num">${arr.length}</div><div class="lbl">${date} · ${time}<br>${route}<br>חפיפה ממוצעת ${avg}%</div></div>`;
  });
  return cards.length ? cards.join('') : '<div class="alert info" style="grid-column:1/-1">אין כרגע קבוצות משתמשים תואמות (נדרשות לפחות 2 בקשות עם אותו תאריך, שעה ומסלול חופף).</div>';
}
function extractCity(addr) { const parts = (addr || '').split(','); return parts[parts.length - 1].trim() || addr; }

function adminUserRow(u) {
  const docs = db.where('documents', d => d.userId === u.id);
  const docStatus = docs.length >= 3 ? (u.status === 'blocked' ? 'לא תואם' : 'תקין') : `${docs.length}/3 הועלו`;
  return `<tr>
    <td>${u.firstName || '—'} ${u.lastName || ''}</td><td>${u.phone || '—'}</td><td>${u.email}</td>
    <td>${u.homeAddress || '—'}</td><td>${u.workAddress || '—'}</td>
    <td>${docStatus}</td><td><span class="badge ${u.status === 'approved' ? 'approved' : u.status === 'blocked' || u.status === 'rejected' ? 'blocked' : 'pending'}">${u.status}</span></td>
    <td class="btn-row">
      <button class="btn btn-red btn-sm" data-block-user="${u.id}">חסום</button>
      <button class="btn btn-green btn-sm" data-approve-user="${u.id}">אשר</button>
    </td>
  </tr>`;
}

function adminRideRow(r) {
  const user = db.find('users', r.userId);
  const matches = findMatchingRides(r);
  const avgOverlap = matches.length ? Math.round(matches.reduce((a, m) => a + m.overlap, 0) / matches.length) : 0;
  return `<tr>
    <td><small>${r.id.slice(0, 6)}</small></td>
    <td>${user ? (user.firstName || user.email) : '—'}</td>
    <td>${r.gregorianDate}</td><td>${r.pickupTime}</td><td>${r.pickupAddress}</td><td>${r.destinationAddress}</td>
    <td>${r.passengersCount}</td>
    <td>${avgOverlap}% · ${matches.length} תואמים</td>
    <td><span class="badge ${r.status}">${r.status}</span></td>
    <td class="btn-row">
      <button class="btn btn-green btn-sm" data-approve-ride="${r.id}">אשר</button>
      <button class="btn btn-red btn-sm" data-reject-ride="${r.id}">דחה</button>
      <button class="btn btn-orange btn-sm" data-offer="${r.id}">הצעת שינוי</button>
    </td>
  </tr>`;
}

function wireAdminEvents() {
  const q = sel => document.querySelectorAll(sel);
  q('[data-block-user]').forEach(b => b.addEventListener('click', () => { blockUser(b.dataset.blockUser, 'נחסם ידנית על ידי admin'); renderAdmin(); }));
  q('[data-approve-user]').forEach(b => b.addEventListener('click', () => { db.update('users', b.dataset.approveUser, { status: 'approved' }); if (State.profile.id === b.dataset.approveUser) State.profile.status = 'approved'; renderAdmin(); }));
  q('[data-approve-ride]').forEach(b => b.addEventListener('click', () => { updateRideStatus(b.dataset.approveRide, 'approved'); renderAdmin(); }));
  q('[data-reject-ride]').forEach(b => b.addEventListener('click', () => { updateRideStatus(b.dataset.rejectRide, 'rejected', 'נדחתה על ידי admin'); renderAdmin(); }));
  q('[data-offer]').forEach(b => b.addEventListener('click', () => openOfferModal(b.dataset.offer)));
}

// updateRideStatus() — שינוי סטטוס בקשה
function updateRideStatus(rideId, status, reason = '') {
  db.update('rideRequests', rideId, { status, rejectionReason: reason });
}

// sendOfferToUser() — יצירת הצעת שינוי למשתמש (סעיף 11.2.6)
function openOfferModal(rideId) {
  openModal(`
    <span class="close-x" data-close>×</span>
    <h2>שליחת הצעת שינוי למשתמש</h2>
    <div class="field"><label>סוג הצעה</label>
      <select id="offer_type">
        <option value="change_date">שינוי מועד</option>
        <option value="change_time">שינוי שעה</option>
        <option value="change_pickup">שינוי כתובת איסוף</option>
        <option value="taxi_full_price">מונית ספיישל בתעריף מלא</option>
      </select></div>
    <div class="field"><label>תאריך חדש</label><input type="date" id="offer_date"></div>
    <div class="field"><label>שעה חדשה</label><input id="offer_time" placeholder="08:15"></div>
    <div class="field"><label>כתובת איסוף חדשה</label><input id="offer_pickup"></div>
    <div class="field"><label>מחיר מונית מלא (אם רלוונטי)</label><input type="number" id="offer_taxi"></div>
    <button class="btn btn-primary" id="send-offer" style="width:100%">שליחת הצעה</button>
  `);
  document.getElementById('send-offer').addEventListener('click', () => {
    sendOfferToUser(rideId, {
      offerType: document.getElementById('offer_type').value,
      newDate: document.getElementById('offer_date').value || null,
      newTime: document.getElementById('offer_time').value || null,
      newPickupAddress: document.getElementById('offer_pickup').value || null,
      taxiFullPrice: document.getElementById('offer_taxi').value ? Number(document.getElementById('offer_taxi').value) : null,
    });
    closeModal();
    renderAdmin();
  });
}

function sendOfferToUser(rideId, offerData) {
  db.insert('offers', { id: uid(), rideRequestId: rideId, ...offerData, scooterCode: null, userResponse: 'pending', createdAt: new Date().toISOString() });
  // מחזירים את הבקשה ל"בטיפול" כדי שההצעה תוצג למשתמש
  db.update('rideRequests', rideId, { status: 'pending' });
}

// ============================================================
//  13. מסך 6 — נהג
// ============================================================
function renderDriver() {
  const approved = db.where('rideRequests', r => r.status === 'approved');
  const options = approved.map(r => `<option value="${r.id}">${r.gregorianDate} ${r.pickupTime} · ${r.pickupAddress} ← ${r.destinationAddress} (${r.passengersCount} נוסעים)</option>`).join('');

  document.getElementById('screen-driver').innerHTML = `
    <h1 class="screen-title">מסך נהג</h1>
    <p class="screen-sub">הזנת מחיר מונה מלא (המערכת מחשבת מחצית לנוסע) ותיקוף ברקוד של נוסע.</p>

    <div class="card">
      <h2>הזנת מחיר לפי מונה</h2>
      <div class="field"><label>בחירת נסיעה מאושרת</label><select id="drv_ride">${options || '<option value="">אין הסעות מאושרות</option>'}</select></div>
      <div class="grid">
        <div class="field"><label>מחיר מלא לפי מונה (₪) <span class="req">*</span></label><input type="number" id="drv_full" min="1"></div>
        <div class="field"><label>מחיר מחצית (מחושב)</label><input id="drv_half" readonly></div>
        <div class="field"><label>מספר נוסעים</label><input id="drv_pax" readonly></div>
        <div class="field"><label>סך תשלום להזמנה (מחושב)</label><input id="drv_total" readonly></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="drv-save">שמירת מחיר וחישוב</button></div>
      <div class="inline-status" id="drv-status"></div>
    </div>

    <div class="card">
      <h2>תיקוף ברקוד / QR של נוסע</h2>
      <div class="field"><label>קוד תיקוף</label><input id="drv_barcode" placeholder="RIDE-2026-000001-USER-123"></div>
      <div class="btn-row"><button class="btn btn-green" id="drv-validate">תקף קוד</button></div>
      <div class="inline-status" id="drv-validate-status"></div>
    </div>`;

  const rideSel = document.getElementById('drv_ride');
  const fullInp = document.getElementById('drv_full');
  const recalc = () => {
    const ride = db.find('rideRequests', rideSel.value);
    if (!ride) return;
    const full = Number(fullInp.value) || 0;
    const { halfPricePerPassenger, totalPrice } = calculateTotalRidePrice(full, ride.passengersCount);
    document.getElementById('drv_half').value = full ? halfPricePerPassenger + ' ₪' : '';
    document.getElementById('drv_pax').value = ride.passengersCount;
    document.getElementById('drv_total').value = full ? totalPrice + ' ₪' : '';
  };
  rideSel.addEventListener('change', recalc);
  fullInp.addEventListener('input', recalc);
  recalc();

  document.getElementById('drv-save').addEventListener('click', () => {
    const ride = db.find('rideRequests', rideSel.value);
    const status = document.getElementById('drv-status');
    if (!ride) { showStatus(status, 'אין נסיעה נבחרת', false); return; }
    const full = Number(fullInp.value);
    if (!full || full <= 0) { showStatus(status, 'יש להזין מחיר מונה חיובי', false); return; }
    const { halfPricePerPassenger, totalPrice } = calculateTotalRidePrice(full, ride.passengersCount);
    db.update('rideRequests', ride.id, { fullMeterPrice: full, halfPricePerPassenger, totalPrice });
    showStatus(status, `✓ נשמר. מחצית לנוסע: ${halfPricePerPassenger} ₪ · סה"כ להזמנה: ${totalPrice} ₪`, true);
  });

  document.getElementById('drv-validate').addEventListener('click', () => {
    const code = document.getElementById('drv_barcode').value.trim();
    const res = validateBarcode(code);
    const status = document.getElementById('drv-validate-status');
    showStatus(status, res.message, res.status === 'valid');
  });
}

// validateBarcode() — תיקוף ברקוד (סעיף 12.2 / 18: לא ניתן להשתמש פעמיים)
function validateBarcode(code) {
  const ride = db.where('rideRequests', r => r.barcode === code)[0];
  if (!ride) return { status: 'invalid', message: '✗ קוד לא תקין — לא נמצאה הסעה תואמת' };
  if (ride.paymentStatus !== 'paid') return { status: 'invalid', message: '✗ ההסעה טרם שולמה' };
  const used = db.where('barcodeValidations', v => v.barcode === code && v.validationStatus === 'valid')[0];
  if (used) return { status: 'already_used', message: '⚠ הקוד כבר נוצל בעבר — לא ניתן להשתמש פעמיים' };
  db.insert('barcodeValidations', { id: uid(), rideRequestId: ride.id, barcode: code, driverId: State.authUser.id, validationStatus: 'valid', validatedAt: new Date().toISOString() });
  return { status: 'valid', message: '✓ הקוד תקין — הנוסע מורשה לעלות להסעה' };
}

// ============================================================
//  14. חוקים אוטומטיים (48 שעות + הצעה אחרי X ימים)
// ============================================================
function runAutomaticRules() {
  const now = new Date();
  const rides = db.all('rideRequests');
  rides.forEach(r => {
    if (r.status !== 'pending') return;
    const pickup = new Date(`${r.gregorianDate}T${r.pickupTime}:00`);
    const diffHours = (pickup - now) / 36e5;
    // חוק 48 שעות (סעיף 8.4 / 16.4)
    if (diffHours <= REJECT_BEFORE_HOURS && diffHours > 0) {
      db.update('rideRequests', r.id, { status: 'rejected', rejectionReason: 'לא נמצאה התאמה עד 48 שעות לפני מועד האיסוף' });
      return;
    }
    // שליחת הצעה אחרי X ימים (סעיף 9.5) — אם קיימת התאמה ואין עדיין הצעה
    const ageDays = (now - new Date(r.createdAt)) / 864e5;
    const hasOffer = db.where('offers', o => o.rideRequestId === r.id).length > 0;
    if (ageDays >= OFFER_AFTER_DAYS && !hasOffer) {
      const matches = findMatchingRides(r);
      if (matches.length) {
        const m = matches[0];
        sendOfferToUser(r.id, { offerType: 'change_time', newTime: shiftTime(r.pickupTime, m.pickupOffsetMinutes), newDate: null, newPickupAddress: null, taxiFullPrice: null });
      }
    }
  });
}

function shiftTime(t, minutes) {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ============================================================
//  15. עזרי UI (מודאל + הודעות)
// ============================================================
function openModal(html) {
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('.modal').innerHTML = html;
  overlay.classList.add('open');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function showStatus(el, msg, ok) { el.textContent = msg; el.className = 'inline-status ' + (ok ? 'ok' : 'err'); }

function wireGlobalEvents() {
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
}

// ---- הפעלה ----
init();
