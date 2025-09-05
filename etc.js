// game.js
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { doc, getDoc, setDoc, runTransaction, onSnapshot, collection, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// HTML参照
const $ = (s,r=document)=>r.querySelector(s);
const ui = {
  name: $("#player-name"), money: $("#money"), fans: $("#fans"), rep: $("#rep"), emps: $("#emps"),
  projects: $("#projects"), projCount: $("#proj-count"), released: $("#released"), relCount: $("#rel-count"),
  leaderboard: $("#leaderboard"), tick: $("#tick-indicator"), admin: $("#admin-panel")
};
const COST = { hire: 50000, train: 10000, project: 100000, marketing: 30000 };
const LIMITS = { deltaMoneyPerWrite: 150000 };
let tickTimer=null, tickCount=0, unsubUser=null, unsubLB=null;

// アクション用ヘルパー
function randomName(){
  const a=['Super','Mega','Ultra','Hyper','Neo','Quantum','Pixel','Retro','Cyber','Myth'];
  const b=['Quest','Runner','Tycoon','Saga',' Odyssey',' Legends',' Maker',' Arena',' Raid',' Factory'];
  return a[Math.floor(Math.random()*a.length)]+b[Math.floor(Math.random()*b.length)];
}
function capDelta(oldMoney,newMoney){ return Math.min(newMoney, oldMoney+LIMITS.deltaMoneyPerWrite); }

// ユーザーデータ更新（トランザクション）
export async function txUpdate(uid, mutator, db){
  const uref = doc(db,'users',uid);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(uref);
    const data = snap.data();
    const next = JSON.parse(JSON.stringify(data));
    mutator(next);
    next.money = capDelta(data.money, next.money);
    next.lastWriteTime = new Date();
    tx.update(uref,next);
  });
}

// ユーザー情報描画
function renderUser(u){
  ui.money.textContent = `¥${u.money.toLocaleString()}`;
  ui.fans.textContent = u.fans.toLocaleString();
  ui.rep.textContent = u.reputation;
  ui.emps.textContent = u.employees;

  // プロジェクト
  ui.projects.innerHTML='';
  (u.projects||[]).forEach(p=>{
    const el=document.createElement('div');
    el.className='p-3 rounded-xl bg-slate-900/40 border border-white/10';
    el.innerHTML=`<div class="flex items-center justify-between">
      <div class="font-semibold">${p.name}</div>
      <div class="text-xs opacity-70">進捗 ${p.progress}% / バグ ${p.bugs}</div>
    </div>
    <div class="w-full bg-white/10 rounded h-2 mt-2"><div class="h-2 rounded bg-white/60" style="width:${p.progress}%"></div></div>`;
    ui.projects.appendChild(el);
  });
  ui.projCount.textContent=`${(u.projects||[]).length}件`;

  // リリース済み
  ui.released.innerHTML='';
  (u.released||[]).slice(-8).reverse().forEach(g=>{
    const el=document.createElement('div');
    el.className='p-3 rounded-xl bg-slate-900/40 border border-white/10';
    el.innerHTML=`<div class="flex items-center justify-between">
      <div class="font-semibold">${g.name}</div>
      <div class="text-xs opacity-70">品質 ${g.quality} / 基礎売上 ¥${g.baseRevenue.toLocaleString()}</div>
    </div>`;
    ui.released.appendChild(el);
  });
  ui.relCount.textContent=`${(u.released||[]).length}本`;
}

// リアルタイム監視
export function listenUser(uid, db){
  if(unsubUser) unsubUser();
  unsubUser = onSnapshot(doc(db,'users',uid), snap=>{
    if(snap.exists()) renderUser(snap.data());
  });
}

export function listenLeaderboard(db){
  if(unsubLB) unsubLB();
  const q = query(collection(db,'leaderboard'), orderBy('money','desc'), limit(20));
  unsubLB = onSnapshot(q, qs=>{
    ui.leaderboard.innerHTML='';
    let i=1;
    qs.forEach(d=>{
      const li=document.createElement('li');
      li.innerHTML=`<span class="mr-2 opacity-70">#${i++}</span> <span class="font-semibold">${d.data().name || 'Player'}</span> <span class="float-right mono">¥${(d.data().money||0).toLocaleString()}</span>`;
      ui.leaderboard.appendChild(li);
    });
  });
}

// Tick処理（パッシブ収入）
export function startTick(uid, db){
  if(tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(async ()=>{
    tickCount++; ui.tick.textContent=`tick: ${tickCount}`;
    await txUpdate(uid, u=>{
      let income=0;
      for(const g of u.released||[]){
        g.baseRevenue=Math.floor(g.baseRevenue*0.98);
        income+=Math.max(0,Math.floor(g.baseRevenue*0.2 + Math.random()*3000));
      }
      const salaries=(u.employees||0)*8000;
      const upkeep=3000;
      u.money = u.money + income - salaries - upkeep;
      if(u.money<0){ u.money=50000; u.reputation=Math.max(1,u.reputation-1); }
    }, db);
  }, 5000);
}

// アクションバインド
export function bindActions(uid, db){
  $('#act-hire').onclick = ()=> txUpdate(uid, u=>{ if(u.money<COST.hire) return; u.money-=COST.hire; u.employees+=1; }, db);
  $('#act-train').onclick = ()=> txUpdate(uid, u=>{ if(u.money<COST.train) return; u.money-=COST.train; u.reputation=Math.min(u.reputation+1,10); }, db);
  $('#act-start-proj').onclick = ()=> txUpdate(uid, u=>{ 
    if(u.money<COST.project) return; u.money-=COST.project; 
    u.projects.push({ id: crypto.randomUUID(), name: randomName(), progress:0, bugs:0, quality:u.reputation }); 
  }, db);
  $('#act-sprint').onclick = ()=> txUpdate(uid, u=>{ 
    if(!u.projects.length) return; 
    for(const p of u.projects){
      const speed=Math.max(1, Math.floor(u.employees*(0.6+Math.random()*0.8)));
      p.progress=Math.min(100,p.progress+speed);
      p.bugs=Math.max(0,p.bugs+Math.floor((Math.random()*4)-1));
    } 
  }, db);
  $('#act-release').onclick = ()=> txUpdate(uid, u=>{ 
    const idx=u.projects.findIndex(p=>p.progress>=80); 
    if(idx===-1) return; 
    const p=u.projects.splice(idx,1)[0]; 
    const quality=Math.max(1,Math.min(10,Math.round((p.quality+(100-p.bugs)/20+u.reputation)/3)));
    const baseRevenue=Math.round(40000*quality + u.fans*(50+Math.random()*50));
    u.released.push({ id:p.id, name:p.name, quality, baseRevenue });
    const fansGain=Math.round(quality*(30+Math.random()*120));
    u.fans+=fansGain;
  }, db);
  $('#act-marketing').onclick = ()=> txUpdate(uid, u=>{ if(u.money<COST.marketing) return; u.money-=COST.marketing; u.fans+=Math.round(200+Math.random()*400); }, db);
}

// 初期化（onAuthStateChanged から呼ぶ）
export function initGame(user, db){
  bindActions(user.uid, db);
  startTick(user.uid, db);
  listenUser(user.uid, db);
  listenLeaderboard(db);
}
