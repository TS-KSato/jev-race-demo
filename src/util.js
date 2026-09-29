export const pad=s=>String(s).padStart(2,'0');
export const r1=v=>v==null||isNaN(v)?null:Math.round(v*10)/10;
export const normName=s=>(s||'').replace(/\s+/g,'');
export const DATE_RE=/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\S+)/;
export function toSec(t){const m=String(t||'').match(/^(?:(\d+):)?(\d+\.\d)$/);return m?(m[1]?+m[1]*60:0)+parseFloat(m[2]):null;}
export function daysBetween(a,b){const d=(new Date(a)-new Date(b))/864e5;return isNaN(d)?null:Math.round(d);}
