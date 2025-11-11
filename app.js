// ==========================
// app.js — lógica de la app
// ==========================

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const nowISO = () => new Date().toISOString();
const fmtDate = iso => new Date(iso).toLocaleString();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const isEmpty = v => !v || String(v).trim()==='';
const onlyDigits = v => String(v||'').replace(/\D+/g,'');

// ---------- Tabs ----------
function buildTabs(){
  const sections = [
    { id:'sec-asignar',     label:'Asignar' },
    { id:'sec-tablets',     label:'Tablets' },
    { id:'sec-conductores', label:'Conductores' },
    { id:'sec-vehiculos',   label:'Vehículos' },
    { id:'sec-sims',        label:'SIMs' },
    { id:'sec-ajustes',     label:'Ajustes' },
  ];
  const tabsEl = $('#tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML='';
  sections.forEach((s,i)=>{
    const b = document.createElement('button');
    b.className = 'tab' + (i===0?' active':'');
    b.textContent = s.label;
    b.onclick = ()=>{
      $$('.tab').forEach(t=>t.classList.remove('active'));
      b.classList.add('active');
      $$('.section').forEach(sec=>sec.classList.remove('active'));
      document.getElementById(s.id)?.classList.add('active');
    };
    tabsEl.appendChild(b);
  });
}

// ---------- IndexedDB ----------
const DB_NAME = 'asignadorDB';
const DB_VER  = 1;
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (ev)=>{
      const d = ev.target.result;
      if(!d.objectStoreNames.contains('tablets')){
        const s = d.createObjectStore('tablets', { keyPath:'imei' });
        s.createIndex('modelo','modelo',{unique:false});
        s.createIndex('estado','estado',{unique:false});
      }
      if(!d.objectStoreNames.contains('conductores')){
        d.createObjectStore('conductores', { keyPath:'rut' });
      }
      if(!d.objectStoreNames.contains('vehiculos')){
        d.createObjectStore('vehiculos', { keyPath:'patente' });
      }
      if(!d.objectStoreNames.contains('sims')){
        d.createObjectStore('sims', { keyPath:'numero' });
      }
      if(!d.objectStoreNames.contains('asignaciones')){
        const a = d.createObjectStore('asignaciones', { keyPath:'id' });
        a.createIndex('estado','estado',{unique:false});
        a.createIndex('tabletImei','tabletImei',{unique:false});
        a.createIndex('patente','patente',{unique:false});
      }
    };
    req.onsuccess = ()=>{ db = req.result; resolve(db); };
    req.onerror   = ()=> reject(req.error);
  });
}

function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
const getAll = (store)=> new Promise((res,rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);});
const get    = (store,key)=> new Promise((res,rej)=>{ const r=tx(store).get(key);  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);});
const put    = (store,obj)=> new Promise((res,rej)=>{ const r=tx(store,'readwrite').put(obj); r.onsuccess=()=>res(true);   r.onerror=()=>rej(r.error);});
const del    = (store,key)=> new Promise((res,rej)=>{ const r=tx(store,'readwrite').delete(key); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error);});

// ---------- Firestore ONLINE ----------
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let USE_FIREBASE = false;
let fbApp = null, auth = null, fs = null;

let FB_CONNECTED = false;
function setFbDot(ok, msg=""){
  const dot = document.getElementById('fb-dot');
  const lbl = document.getElementById('firebase-status');
  FB_CONNECTED = !!ok;
  if(dot){
    dot.classList.toggle('ok', ok);
    dot.classList.toggle('bad', !ok);
    dot.title = ok ? "Firestore: conectado" : "Firestore: desconectado";
  }
  if(lbl && msg) lbl.textContent = msg;
}

async function pingFirestore(){
  if(!USE_FIREBASE){ setFbDot(false, "Firestore OFF"); return; }
  try{
    const { getDocFromServer, doc, collection: coll } =
      await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    await getDocFromServer(doc(coll(fs, "__health"), "ping"));
    setFbDot(true);
  }catch{
    setFbDot(false);
  }
}
window.addEventListener('online',  ()=> pingFirestore());
window.addEventListener('offline', ()=> setFbDot(false));

const firebaseConfig = {
  apiKey: "AIzaSyBOoHRADT4yOCpytPvcyHcaWSB1pT2ZB8I",
  authDomain: "asignadortablet.firebaseapp.com",
  projectId: "asignadortablet",
  storageBucket: "asignadortablet.firebasestorage.app",
  messagingSenderId: "261128444351",
  appId: "1:261128444351:web:996b8a3171da8d20f6e90a"
};

async function enableFirebase(){
  try{
    fbApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    fs = getFirestore(fbApp);
    auth = getAuth(fbApp);
    try{ await signInAnonymously(auth); }catch(_){} // si no está habilitado, seguimos
    USE_FIREBASE = true;
    setFbDot(true, `Firestore activo (proyecto: ${firebaseConfig.projectId})`);
    pingFirestore();
    setInterval(pingFirestore, 15000);
    $('#firebase-status')?.textContent = `Firestore activo (proyecto: ${firebaseConfig.projectId})`;
  }catch(e){
    console.error(e);
    $('#firebase-status')?.textContent = 'Error activando Firestore';
  }
}

// Escritura con reintento manual
async function syncWrite(collectionName, key, data){
  if(!USE_FIREBASE){ console.warn("Firestore OFF"); return; }
  try{
    const { collection: coll, doc, setDoc } =
      await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    await setDoc(doc(coll(fs, collectionName), key), data, { merge:true });
    console.log(`Firestore OK → ${collectionName}/${key}`);
  }catch(e){
    console.error("Firestore ERR:", e);
    alert("Error Firestore: " + (e.code || e.message));
    setFbDot(false);
  }
}

// Reenvío masivo
async function resendStore(storeName, collectionName, keyField){
  if(!USE_FIREBASE){ alert("Firestore no está activo"); return; }
  const items = await getAll(storeName);
  const { collection: coll, doc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  let ok = 0, fail = 0;
  for (const it of items){
    const key = it[keyField];
    if(!key) continue;
    try { await setDoc(doc(coll(fs, collectionName), key), it, { merge:true }); ok++; }
    catch(e){ console.error("Resend fail", collectionName, key, e); fail++; }
  }
  alert(`Reenvío ${collectionName}: OK ${ok}, errores ${fail}`);
}

// ---------- UI: selects/tablas ----------
async function refreshMasterSelects(){ /* igual que tu versión */ 
  const [vehiculos, conductores, sims] = await Promise.all([
    getAll('vehiculos'), getAll('conductores'), getAll('sims')
  ]);
  const vehSel = $('#asig-vehiculo'); vehSel.innerHTML='';
  vehiculos.sort((a,b)=>a.patente.localeCompare(b.patente)).forEach(v=>{
    const opt=document.createElement('option'); opt.value=v.patente;
    opt.textContent=`${v.patente} — ${v.sigla||''}`.trim(); vehSel.appendChild(opt);
  });
  const conSel = $('#asig-conductor'); conSel.innerHTML='';
  conductores.sort((a,b)=>a.rut.localeCompare(b.rut)).forEach(c=>{
    const opt=document.createElement('option'); opt.value=c.rut;
    opt.textContent=`${c.rut} — ${c.nombre}`; conSel.appendChild(opt);
  });
  const simSel = $('#asig-sim-numero'); simSel.innerHTML='';
  sims.sort((a,b)=>(a.numero||'').localeCompare(b.numero||'')).forEach(s=>{
    const opt=document.createElement('option'); opt.value=s.numero;
    opt.textContent=`${s.numero} (${s.iccid||'sin ICCID'})`; simSel.appendChild(opt);
  });
}

async function renderTablets(){ /* igual */ 
  const tbody = $('#tabla-tablets tbody');
  const q = ($('#filtro-tablets').value||'').toLowerCase();
  const items = (await getAll('tablets')).filter(t=>
    t.imei.toLowerCase().includes(q) || (t.modelo||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(t=>`
    <tr><td>${t.imei}</td><td>${t.modelo||''}</td><td>${t.estado||'disponible'}</td>
    <td>${t.nota||''}</td><td><button class="btn red" data-del-tablet="${t.imei}">Eliminar</button></td></tr>
  `).join('');
}

async function renderConductores(){ /* igual */ 
  const tbody = $('#tabla-conductores tbody');
  const q = ($('#filtro-conductores').value||'').toLowerCase();
  const items = (await getAll('conductores')).filter(c=>
    c.rut.toLowerCase().includes(q) || (c.nombre||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(c=>`
    <tr><td>${c.rut}</td><td>${c.nombre||''}</td>
    <td><button class="btn red" data-del-conductor="${c.rut}">Eliminar</button></td></tr>
  `).join('');
}

async function renderVehiculos(){ /* igual */ 
  const tbody = $('#tabla-vehiculos tbody');
  const q = ($('#filtro-vehiculos').value||'').toLowerCase();
  const items = (await getAll('vehiculos')).filter(v=>
    v.patente.toLowerCase().includes(q) || (v.sigla||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(v=>`
    <tr><td>${v.patente}</td><td>${v.sigla||''}</td>
    <td><button class="btn red" data-del-veh="${v.patente}">Eliminar</button></td></tr>
  `).join('');
}

async function renderSims(){ /* igual */ 
  const tbody = $('#tabla-sims tbody');
  const q = ($('#filtro-sims').value||'').toLowerCase();
  const items = (await getAll('sims')).filter(s=>
    (s.numero||'').toLowerCase().includes(q) || (s.iccid||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = items.map(s=>`
    <tr><td>${s.numero||''}</td><td>${s.iccid||''}</td><td>${s.simImei||''}</td>
    <td><button class="btn red" data-del-sim="${s.numero}">Eliminar</button></td></tr>
  `).join('');
}

async function renderAsignaciones(){ /* igual */ 
  const tbody = $('#tabla-asignaciones tbody');
  const q = ($('#filtro').value||'').toLowerCase();
  const items = (await getAll('asignaciones')).filter(a=> !a.devueltoEn );
  const filt = items.filter(a=>
    (a.patente||'').toLowerCase().includes(q) || (a.sigla||'').toLowerCase().includes(q) ||
    (a.tabletImei||'').toLowerCase().includes(q) || (a.rut||'').toLowerCase().includes(q)
  );
  tbody.innerHTML = filt.sort((a,b)=> b.entregadoEn.localeCompare(a.entregadoEn)).map(a=>{
    const pill = a.red==='SIM'?'<span class="pill sim">SIM</span>':'<span class="pill wifi">WIFI</span>';
    const estado = `<span class="status entregado">Entregado</span>`;
    const simTxt = a.red==='SIM' ? `${a.simNumero||''}\n${a.simIccid||''}` : '';
    return `
      <tr>
        <td title="${a.entregadoEn}">${fmtDate(a.entregadoEn)}</td>
        <td>${a.patente||''}</td><td>${a.sigla||''}</td><td>${a.tabletImei||''}</td>
        <td>${pill}</td><td style="white-space:pre-line">${simTxt}</td>
        <td>${a.rut||''}</td><td>${estado}</td><td>${a.observacion||''}</td>
        <td><button class="btn" data-retirar="${a.id}">Retirar</button></td>
      </tr>`;
  }).join('');
}

// ---------- Eventos ----------
document.addEventListener('click', async (e)=>{
  const imei = e.target?.dataset?.delTablet;
  if(imei){ if(!confirm('Eliminar tablet '+imei+'?')) return;
    await del('tablets', imei); await renderTablets(); await refreshMasterSelects(); return; }
  const rut = e.target?.dataset?.delConductor;
  if(rut){ if(!confirm('Eliminar conductor '+rut+'?')) return;
    await del('conductores', rut); await renderConductores(); await refreshMasterSelects(); return; }
  const pat = e.target?.dataset?.delVeh;
  if(pat){ if(!confirm('Eliminar vehículo '+pat+'?')) return;
    await del('vehiculos', pat); await renderVehiculos(); await refreshMasterSelects(); return; }
  const n = e.target?.dataset?.delSim;
  if(n){ if(!confirm('Eliminar SIM '+n+'?')) return;
    await del('sims', n); await renderSims(); await refreshMasterSelects(); return; }
});

$('#btn-add-tablet')?.addEventListener('click', async ()=>{
  const imei = onlyDigits($('#tab-imei').value);
  const modelo = $('#tab-modelo').value.trim();
  const nota = $('#tab-nota').value.trim();
  if(isEmpty(imei)) return alert('IMEI requerido');
  const obj = { imei, modelo, provisional:true, estado:'disponible', nota };
  await put('tablets', obj); await syncWrite('tablets', imei, obj);
  $('#tab-imei').value=''; $('#tab-modelo').value=''; $('#tab-nota').value='';
  await renderTablets(); await refreshMasterSelects();
});

$('#btn-add-conductor')?.addEventListener('click', async ()=>{
  const rut = $('#con-rut').value.trim();
  const nombre = $('#con-nombre').value.trim();
  if(isEmpty(rut) || isEmpty(nombre)) return alert('RUT y Nombre son requeridos');
  const obj = { rut, nombre };
  await put('conductores', obj); await syncWrite('conductores', rut, obj);
  $('#con-rut').value=''; $('#con-nombre').value=''; await renderConductores(); await refreshMasterSelects();
});

$('#btn-add-veh')?.addEventListener('click', async ()=>{
  const patente = ($('#veh-patente').value||'').trim().toUpperCase();
  const sigla = ($('#veh-sigla').value||'').trim();
  if(isEmpty(patente)) return alert('Patente requerida');
  const obj = { patente, sigla };
  await put('vehiculos', obj); await syncWrite('vehiculos', patente, obj);
  $('#veh-patente').value=''; $('#veh-sigla').value=''; await renderVehiculos(); await refreshMasterSelects();
});

$('#btn-add-sim')?.addEventListener('click', async ()=>{
  const numero = onlyDigits($('#sim-numero').value);
  const iccid  = onlyDigits($('#sim-iccid').value);
  const simImei= onlyDigits($('#sim-imei').value);
  if(isEmpty(numero)) return alert('Número SIM requerido');
  const obj = { numero, iccid, simImei };
  await put('sims', obj); await syncWrite('sims', numero, obj);
  $('#sim-numero').value=''; $('#sim-iccid').value=''; $('#sim-imei').value='';
  await renderSims(); await refreshMasterSelects();
});

$('#asig-red')?.addEventListener('change', ()=>{
  $('#sim-block').style.display = ($('#asig-red').value==='SIM') ? 'grid' : 'none';
});

$('#btn-crear-asig')?.addEventListener('click', async ()=>{
  const patente   = $('#asig-vehiculo').value;
  const conRut    = $('#asig-conductor').value;
  const tabletImei= onlyDigits($('#asig-tablet-imei').value);
  const red       = $('#asig-red').value;
  const obs       = $('#asig-obs').value.trim();
  if(isEmpty(patente) || isEmpty(conRut) || isEmpty(tabletImei))
    return alert('Patente, Conductor e IMEI son obligatorios');
  const veh = await get('vehiculos', patente); if(!veh) return alert('Vehículo no existe');
  const tab = await get('tablets', tabletImei); if(!tab) return alert('Tablet IMEI no está registrada en Maestros');

  const asig = {
    id: uid(), tabletImei, patente, sigla: veh.sigla||'', rut: conRut, red,
    simNumero: red==='SIM'? $('#asig-sim-numero').value : '',
    simIccid:  red==='SIM'? onlyDigits($('#asig-sim-iccid').value) : '',
    simImei:   red==='SIM'? onlyDigits($('#asig-sim-imei').value) : '',
    entregadoEn: nowISO(), devueltoEn: null, estado:'Entregado', observacion: obs, creadoPor:'web'
  };
  await put('asignaciones', asig);
  await put('tablets', { ...tab, estado:'asignada' });
  await syncWrite('asignaciones', asig.id, asig);
  await syncWrite('tablets', tab.imei, { ...tab, estado:'asignada' });
  $('#asig-tablet-imei').value=''; $('#asig-obs').value='';
  await renderAsignaciones(); await renderTablets();
});

document.getElementById('tabla-asignaciones')?.addEventListener('click', async (e)=>{
  const id = e.target?.dataset?.retirar; if(!id) return;
  if(!confirm('Marcar como Retirado?')) return;
  const a = await get('asignaciones', id); if(!a) return;
  a.devueltoEn = nowISO(); a.estado='Retirado';
  await put('asignaciones', a);
  const tab = await get('tablets', a.tabletImei);
  if(tab){ await put('tablets', { ...tab, estado:'disponible' }); await renderTablets(); }
  await renderAsignaciones();
  await syncWrite('asignaciones', a.id, a);
  if(tab) await syncWrite('tablets', tab.imei, { ...tab, estado:'disponible' });
});

// Filtros / Export
$('#filtro')?.addEventListener('input', renderAsignaciones);
$('#filtro-tablets')?.addEventListener('input', renderTablets);
$('#filtro-conductores')?.addEventListener('input', renderConductores);
$('#filtro-vehiculos')?.addEventListener('input', renderVehiculos);
$('#filtro-sims')?.addEventListener('input', renderSims);

document.getElementById('btn-export')?.addEventListener('click', async ()=>{
  const all = await getAll('asignaciones');
  const rows = [['id','entregadoEn','devueltoEn','estado','patente','sigla','tabletImei','red','simNumero','simIccid','simImei','rut','observacion']];
  all.sort((a,b)=> (b.entregadoEn||'').localeCompare(a.entregadoEn||''));
  for (const a of all){
    rows.push([a.id,a.entregadoEn,a.devueltoEn||'',a.estado,a.patente||'',a.sigla||'',a.tabletImei||'',a.red||'',a.simNumero||'',a.simIccid||'',a.simImei||'',a.rut||'',(a.observacion||'').replace(/\n/g,' ')]);
  }
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='asignaciones.csv'; a.click(); URL.revokeObjectURL(url);
});

// Escáner
async function scanOnce(){
  try{
    const { BrowserMultiFormatReader } = await import('https://unpkg.com/@zxing/library@0.20.0/esm/index.js');
    const codeReader = new BrowserMultiFormatReader();
    const devices = await codeReader.listVideoInputDevices();
    const deviceId = devices?.[0]?.deviceId;
    const result = await codeReader.decodeOnceFromVideoDevice(deviceId, 'video-preview');
    codeReader.reset(); return result?.text || '';
  }catch{ alert('Escáner no disponible (requiere https/permiso de cámara).'); return ''; }
}
function ensurePreview(){
  if(document.getElementById('video-preview')) return;
  const v = document.createElement('video'); v.id='video-preview'; v.setAttribute('playsinline','');
  v.style.width='1px'; v.style.height='1px'; v.style.opacity='0'; document.body.appendChild(v);
}
document.getElementById('scan-tablet')?.addEventListener('click', async ()=>{ ensurePreview(); const t=await scanOnce(); if(t) $('#asig-tablet-imei').value=onlyDigits(t); });
document.getElementById('scan-sim')?.addEventListener('click', async ()=>{ ensurePreview(); const t=await scanOnce(); if(t) $('#asig-sim-iccid').value=onlyDigits(t); });
document.getElementById('scan-tab-master')?.addEventListener('click', async ()=>{ ensurePreview(); const t=await scanOnce(); if(t) $('#tab-imei').value=onlyDigits(t); });
document.getElementById('scan-sim-master')?.addEventListener('click', async ()=>{ ensurePreview(); const t=await scanOnce(); if(t) $('#sim-iccid').value=onlyDigits(t); });

// Reenviar masivo
document.getElementById('sync-tablets')?.addEventListener('click', ()=>resendStore('tablets','tablets','imei'));
document.getElementById('sync-conductores')?.addEventListener('click', ()=>resendStore('conductores','conductores','rut'));
document.getElementById('sync-vehiculos')?.addEventListener('click', ()=>resendStore('vehiculos','vehiculos','patente'));
document.getElementById('sync-sims')?.addEventListener('click', ()=>resendStore('sims','sims','numero'));
document.getElementById('sync-asignaciones')?.addEventListener('click', ()=>resendStore('asignaciones','asignaciones','id'));

// Ajustes (opcional)
document.getElementById('btn-guardar-config')?.addEventListener('click', ()=>{
  const txt=$('#firebase-config').value.trim();
  try{ JSON.parse(txt); localStorage.setItem('firebaseConfig', txt); alert('Config guardada'); }
  catch{ alert('JSON inválido'); }
});
document.getElementById('btn-activar-firebase')?.addEventListener('click', ()=> enableFirebase());

// Init
(async function init(){
  buildTabs();
  await openDB();
  await Promise.all([renderTablets(), renderConductores(), renderVehiculos(), renderSims(), renderAsignaciones()]);
  await refreshMasterSelects();
  $('#sim-block').style.display = ($('#asig-red').value==='SIM') ? 'grid' : 'none';
  await enableFirebase(); // online por defecto
  pingFirestore();
  setInterval(pingFirestore, 15000);
})();
