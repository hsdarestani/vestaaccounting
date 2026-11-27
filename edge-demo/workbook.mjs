// Build an uncompressed XLSX archive in the browser without sending reports elsewhere.
export function reportWorkbook(rows,columns,heading,cellValue){
 const encoder=new TextEncoder();
 const xml=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[x]));
 const text=value=>'<c t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
 const data=rows.map(row=>'<row>'+columns.map(key=>{
  const {value,numeric}=cellValue(key,row[key]);
  return value==null?'<c/>':numeric?'<c><v>'+xml(value)+'</v></c>':text(value);
 }).join('')+'</row>').join('');
 const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const doc='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const rel='http://schemas.openxmlformats.org/package/2006/relationships';
 const files={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="'+doc+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="'+main+'" xmlns:r="'+doc+'"><bookViews><workbookView/></bookViews><sheets><sheet name="گزارش وستا" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="'+doc+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':'<worksheet xmlns="'+main+'"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData><row>'+columns.map(key=>text(heading(key))).join('')+'</row>'+data+'</sheetData></worksheet>'
 };
 const table=Uint32Array.from({length:256},(_,i)=>{
  for(let j=0;j<8;j++)i=(i>>>1)^((i&1)?0xedb88320:0);
  return i;
 });
 const local=[],central=[];
 let offset=0,centralSize=0;
 for(const [path,source] of Object.entries(files)){
  const filename=encoder.encode(path),bytes=encoder.encode(source),length=bytes.length;
  let crc=0xffffffff;
  for(const byte of bytes)crc=(crc>>>8)^table[(crc^byte)&255];
  crc=(crc^0xffffffff)>>>0;
  const header=new DataView(new ArrayBuffer(30)),entry=new DataView(new ArrayBuffer(46));
  header.setUint32(0,0x04034b50,true);header.setUint16(4,20,true);header.setUint16(12,33,true);
  header.setUint32(14,crc,true);header.setUint32(18,length,true);header.setUint32(22,length,true);
  header.setUint16(26,filename.length,true);
  entry.setUint32(0,0x02014b50,true);entry.setUint16(4,20,true);entry.setUint16(6,20,true);
  entry.setUint16(14,33,true);entry.setUint32(16,crc,true);entry.setUint32(20,length,true);
  entry.setUint32(24,length,true);entry.setUint16(28,filename.length,true);entry.setUint32(42,offset,true);
  local.push(header.buffer,filename,bytes);central.push(entry.buffer,filename);
  offset+=header.byteLength+filename.length+length;
  centralSize+=entry.byteLength+filename.length;
 }
 const end=new DataView(new ArrayBuffer(22)),count=central.length/2;
 end.setUint32(0,0x06054b50,true);end.setUint16(8,count,true);end.setUint16(10,count,true);
 end.setUint32(12,centralSize,true);end.setUint32(16,offset,true);
 return new Blob([...local,...central,end.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
