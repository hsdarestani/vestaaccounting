// Use the Persian calendar consistently for the input, presets, and displayed dates.
export function reportDates(){
 const parts=new Intl.DateTimeFormat('en-u-ca-persian-nu-latn',{timeZone:'Asia/Tehran',year:'numeric',month:'numeric',day:'numeric'});
 const read=value=>{
  const date=Object.fromEntries(parts.formatToParts(value).filter(x=>['year','month','day'].includes(x.type)).map(x=>[x.type,+x.value]));
  return [date.year,date.month,date.day];
 };
 const parse=raw=>{
  const latin=raw.replace(/[۰-۹٠-٩]/g,d=>String(d.charCodeAt(0)%16));
  const match=latin.trim().match(/^(13\d{2}|14\d{2}|15\d{2})[/-](\d{1,2})[/-](\d{1,2})$/);
  if(!match)return null;
  const [year,month,day]=match.slice(1).map(Number);
  if(month<1||month>12||day<1||day>31)return null;
  const compare=([y,m,d])=>(y-year)*10000+(m-month)*100+d-day;
  const daytime=86400000;
  let low=Math.floor(Date.UTC(year+621,2,18,12)/daytime);
  let high=low+370;
  while(low<=high){
   const mid=Math.floor((low+high)/2),date=new Date(mid*daytime+daytime/2);
   const delta=compare(read(date));
   if(delta===0)return date.toISOString().slice(0,10);
   if(delta>0)high=mid-1;else low=mid+1;
  }
  return null;
 };
 const today=()=>read(new Date());
 const format=([y,m,d])=>[y,m,d].map(x=>String(x).padStart(2,'0')).join('/');
 const preset=(period)=>{
  const [y,m,d]=today();
  if(period==='day')return [format([y,m,d]),format([y,m,d])];
  // The monthly report covers the current Jalali month through today.
  return [format([y,m,1]),format([y,m,d])];
 };
 return {parse,preset,fromISO:day=>format(read(new Date(day+'T12:00:00Z')))};
}
