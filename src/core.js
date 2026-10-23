export const uid = () => crypto.randomUUID();
export const clone = x => structuredClone(x);
export const kinds = {duty:'Dienst',slot:'Event',arena:'Reitplatz',claim:'Dienst',registration:'Event'};
export const points = n => Number(n ?? 0).toLocaleString('de-DE',{maximumFractionDigits:2});
export const first = name => (name || 'Mitglied').split(' ')[0];
export const iso = date => new Date(date).toISOString();
export function parts(date,zone='Europe/Berlin') { const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date));return Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value])); }
export function dateKey(date,zone) { const p=parts(date,zone);return `${p.year}-${p.month}-${p.day}`; }
export function monthKey(date=new Date(),zone) { return dateKey(date,zone).slice(0,7); }
export function addDays(key,n) { const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); }
export function weekday(key) { return (new Date(`${key}T12:00:00Z`).getUTCDay()+6)%7+1; }
export function monday(key) { return addDays(key,1-weekday(key)); }
export function localInstant(key,time,zone='Europe/Berlin') {
  const target=`${key}T${time}`;let ms=Date.parse(target+':00Z');
  for(let i=0;i<4;i++) { const p=parts(ms,zone), actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);const delta=Date.parse(target+':00Z')-actual;if(!delta)break;ms+=delta; }
  const p=parts(ms,zone);if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`!==target)throw new Error('Diese Uhrzeit existiert wegen der Zeitumstellung nicht. Bitte eine andere Zeit wählen.');
  return new Date(ms).toISOString();
}
export function monthGrid(month,zone='Europe/Berlin') { const start=monday(month+'-01'),next=new Date(month+'-15T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const end=next.toISOString().slice(0,7)+'-01';let count=0;while(addDays(start,count)<end)count+=7;return Array.from({length:count},(_,i)=>addDays(start,i)); }
export function format(date,zone='Europe/Berlin',mode='full') { if(!date)return '–';return new Intl.DateTimeFormat('de-DE',{timeZone:zone,...(mode==='time'?{hour:'2-digit',minute:'2-digit'}:mode==='day'?{weekday:'long',day:'numeric',month:'long'}:{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}).format(new Date(date)); }
export function record(kind,data,stableID,id=uid(),version=1) { return {id,kind,stableID,data,version,deleted:false,updatedAt:Math.floor(Date.now()/1000)}; }
export function project(state) {
  let rows=clone(state.snapshots?.[state.selectedID]?.records || []);
  for(const item of state.queue||[]) { if(item.stableID!==state.selectedID || item.status==='conflict')continue;const op=item.operation,old=rows.find(x=>x.id===op.id);if(op.action==='delete'){if(old)old.deleted=true;continue;}
    let data={...op.data};if(old)data={...old.data,...data};else data.userID ??= state.user?.id;
    if(['claim','registration'].includes(op.kind)) { const parent=rows.find(x=>x.id===data.parentID);if(parent){Object.assign(data,{title:parent.data.title,start:parent.data.start,end:parent.data.end,points:parent.data.points,appointmentID:op.kind==='registration'?parent.data.parentID:undefined});} }
    if(old)old.data=data;else rows.push(record(op.kind,data,item.stableID,op.id,0));
  }
  return rows.filter(x=>!x.deleted).sort((a,b)=>(a.data.start||'~').localeCompare(b.data.start||'~'));
}
export function occupancy(offer,rows) { const kind=offer.kind==='duty'?'claim':'registration';return rows.filter(x=>x.kind===kind&&x.data.parentID===offer.id).length; }
export function free(offer,rows) { return Math.max(0,(offer.data.capacity||1)-occupancy(offer,rows)); }
export function ownHorses(state,rows=project(state)) { return rows.filter(x=>x.kind==='horse'&&x.data.userIDs?.includes(state.user?.id)); }
export function myBooking(offer,state,rows=project(state)) { if(offer.kind==='arena')return offer.data.userID===state.user?.id?offer:null;const horses=ownHorses(state,rows).map(x=>x.id);return rows.find(x=>x.kind===(offer.kind==='duty'?'claim':'registration')&&x.data.parentID===offer.id&&(x.data.userID===state.user?.id||(offer.kind==='slot'&&horses.includes(x.data.horseID)))); }
export function needsHandover(booking,now=Date.now()) { const delta=Date.parse(booking.data.start)-Number(now);return booking.kind==='claim'&&delta>0&&delta<=86400000; }
export function canBook(offer,state,rows=project(state),now=Date.now()) { if((!state.demo&&offer.version===0)||!['duty','slot'].includes(offer.kind)||Date.parse(offer.data.start)<=now||!free(offer,rows)||myBooking(offer,state,rows))return false;const parent=rows.find(x=>x.id===offer.data.parentID);return !(offer.kind==='slot'&&Date.parse(parent?.data.deadline)<=now); }
export function conflicts(rows,start,end,userID,horseID,ignore=[]) { return rows.filter(x=>['claim','registration','arena'].includes(x.kind)&&!ignore.includes(x.id)&&(x.data.userID===userID||(horseID&&x.data.horseID===horseID))&&Date.parse(x.data.start)<Date.parse(end)&&Date.parse(x.data.end)>Date.parse(start)); }
export function progress(state,month=monthKey(new Date(),state.snapshots?.[state.selectedID]?.stable.timezone),now=Date.now()) {
  const snap=state.snapshots?.[state.selectedID];if(!snap)return [];
  const rows=project(state),source=snap.progress?.month===month?snap.progress:null;if(source?.closed)return source.horses;
  const plan=rows.find(x=>x.kind==='month'&&x.data.month===month),ids=plan?.data.horseIDs||source?.horses?.map(x=>x.horseID)||[];
  const cap=rows.filter(x=>x.kind==='duty'&&monthKey(x.data.start,snap.stable.timezone)===month).reduce((n,x)=>n+(x.data.points??1)*(x.data.capacity||1),0);
  return ids.map(id=>{const base=source?.horses?.find(x=>x.horseID===id),horse=rows.find(x=>x.id===id),claims=rows.filter(x=>x.kind==='claim'&&x.data.horseID===id&&monthKey(x.data.start,snap.stable.timezone)===month),contributions={};let past=0,future=0;
    for(const claim of claims){const duty=rows.find(x=>x.id===claim.data.parentID),p=duty?.data.points??claim.data.points??1;const old=Date.parse(claim.data.end)<=now;if(old)past+=p;else future+=p;contributions[claim.data.userID]??={userID:claim.data.userID,past:0,future:0};contributions[claim.data.userID][old?'past':'future']+=p;}
    return {horseID:id,title:horse?.data.title||base?.title||'Pferdekonto',target:plan?(plan.data.overrides?.[id]??(plan.data.target??cap)/Math.max(1,ids.length)):(base?.target??0),past,future,total:past+future,contributions:Object.values(contributions)};
  });
}
export function firstSeen(state,notice,rows=project(state)) { const dates=[state.noticeFirstSeen?.[`${state.user?.id}|${notice.id}`],...rows.filter(x=>x.kind==='noticeSeen'&&x.data.parentID===notice.id&&x.data.userID===state.user?.id).map(x=>x.data.seenAt)].filter(Boolean).map(Date.parse);return dates.length?Math.min(...dates):null; }
export function currentNews(state,now=Date.now()) { const rows=project(state);return rows.filter(x=>x.kind==='notice'&&x.data.current===true&&(firstSeen(state,x,rows)===null||now-firstSeen(state,x,rows)<86400000)); }
export async function receiptID(userID,noticeID) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${userID.toLowerCase()}|${noticeID.toLowerCase()}`));const h=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
export function available(pref,offer,zone) { if(!pref)return true;const d=offer.data,p=parts(d.start,zone),q=parts(d.end,zone);return (pref.weekdays||[]).includes(weekday(dateKey(d.start,zone)))&&dateKey(d.start,zone)===dateKey(d.end,zone)&&`${p.hour}:${p.minute}`>=(pref.timeFrom||'00:00')&&`${q.hour}:${q.minute}`<=(pref.timeTo||'23:59'); }
export function suggestions(state,now=Date.now()) { const rows=project(state),snap=state.snapshots[state.selectedID],zone=snap.stable.timezone,pref=rows.find(x=>x.kind==='availability'&&x.data.userID===state.user?.id)?.data,goals=progress(state,monthKey(now,zone),now);const horses=ownHorses(state,rows).sort((a,b)=>{const g=id=>{const x=goals.find(g=>g.horseID===id);return Math.max(0,(x?.target||0)-(x?.total||0));};return g(b.id)-g(a.id);});
  return rows.filter(x=>x.kind==='duty'&&canBook(x,state,rows,now)&&Date.parse(x.data.start)<now+28*86400000&&available(pref,x,zone)).flatMap(offer=>{const horse=horses.find(h=>!conflicts(rows,offer.data.start,offer.data.end,state.user.id,h.id).length);if(!horse)return [];const goal=goals.find(x=>x.horseID===horse.id),missing=Math.max(0,(goal?.target||0)-(goal?.total||0));return [{offer,horse,missing,favorite:pref?.preferredTypeIDs?.includes(offer.data.parentID)||false}];}).sort((a,b)=>Number(b.missing>0)-Number(a.missing>0)||Number(b.favorite)-Number(a.favorite)||Math.abs(a.missing-(a.offer.data.points||1))-Math.abs(b.missing-(b.offer.data.points||1))||a.offer.data.start.localeCompare(b.offer.data.start)).slice(0,10);
}
export function templatePreview(state,template,start,weeks=1,excluded=[]) { const rows=project(state),zone=state.snapshots[state.selectedID].stable.timezone,out=[],seen=new Set();for(let w=0;w<weeks;w++)for(const [i,e] of template.data.entries.entries()){const key=addDays(monday(start),w*7+e.weekday-1),type=rows.find(x=>x.id===e.typeID);if(!type)continue;let begin,invalid=false;try{begin=localInstant(key,e.time,zone);}catch{invalid=true;begin=key+'T12:00:00Z';}const signature=`${e.typeID}|${begin}`,duplicate=rows.some(x=>x.kind==='duty'&&x.data.parentID===e.typeID&&Date.parse(x.data.start)===Date.parse(begin))||seen.has(signature);seen.add(signature);out.push({id:`${w}-${i}`,dateKey:key,start:begin,end:iso(Date.parse(begin)+e.minutes*60000),type,entry:e,invalid,skipped:excluded.includes(key)||Date.parse(begin)<=Date.now()||duplicate});}return out.sort((a,b)=>a.start.localeCompare(b.start)); }
export function validateAPI(value) { const u=new URL(value);if(u.username||u.password||u.search||u.hash||(!(u.protocol==='https:')&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw new Error('Bitte eine HTTPS-Adresse ohne Zugangsdaten, Query oder Fragment eingeben.');return u.href.replace(/\/$/,''); }
