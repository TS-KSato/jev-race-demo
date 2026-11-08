export const pad=s=>String(s).padStart(2,'0');
export const r1=v=>v==null||isNaN(v)?null:Math.round(v*10)/10;
export const normName=s=>(s||'').replace(/\s+/g,'');
export const DATE_RE=/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\S+)/;
export function toSec(t){const m=String(t||'').match(/^(?:(\d+):)?(\d+\.\d)$/);return m?(m[1]?+m[1]*60:0)+parseFloat(m[2]):null;}
export function daysBetween(a,b){const d=(new Date(a)-new Date(b))/864e5;return isNaN(d)?null:Math.round(d);}

/* 結果の前半3Fの表示。null のときは、算出しない理由を添える（画面と記録の要約で共用） */
export function formatFirst3f(first3f,distance){
  if(typeof first3f==='number'&&Number.isFinite(first3f)) return first3f.toFixed(1);
  if(!distance) return '算出しない（距離が読み取れないため）';
  if(distance%200!==0) return '算出しない（距離が200mで割り切れず、最初の区間が200m未満のため）';
  return '—';
}
