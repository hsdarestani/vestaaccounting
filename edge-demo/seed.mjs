// All identities, amounts and source references are fabricated for evaluation.
// Callback must call the authenticated operation API so real posting invariants apply.
export async function seedDemo(call){
  const make=async(kind,data)=>(await call({kind,...data})).id;
  const d='2026-11-22',prev='2026-11-21';
  await make('period',{title:'سال مالی آزمایشی ۱۴۰۵',starts:'2026-03-21',ends:'2027-03-20'});
  const c1=await make('customer',{name:'مشتری نمونه آوا',ref:'DEMO-C01'}),c2=await make('customer',{name:'مشتری نمونه بهار',ref:'DEMO-C02'}),c3=await make('customer',{name:'خرید مهمان نمونه',ref:'DEMO-GUEST-03'}),c4=await make('customer',{name:'مشتری نمونه ماهان',ref:'DEMO-C04'});
  const s1=await make('supplier',{name:'پخش نمونه گلبرگ',ref:'DEMO-S01'}),s2=await make('supplier',{name:'تأمین‌کننده نمونه نیلوفر',ref:'DEMO-S02'}),s3=await make('supplier',{name:'بازرگانی نمونه چکاد',ref:'DEMO-S03'});
  const p=[];for(const [product_id,variation_id,name,variant,sku,category] of [[101,1001,'رژ لب مخملی','رز ملایم','DEMO-LIP-R01','آرایش لب'],[101,1002,'رژ لب مخملی','قرمز کلاسیک','DEMO-LIP-R02','آرایش لب'],[102,1003,'کوشن سبک','شماره ۲۱','DEMO-CUSH-21','آرایش صورت'],[102,1004,'کوشن سبک','شماره ۲۳','DEMO-CUSH-23','آرایش صورت'],[103,0,'ریمل حجم‌دهنده','','DEMO-MASC-01','آرایش چشم'],[104,0,'سرم رطوبت‌رسان','','DEMO-SER-01','مراقبت پوست'],[105,0,'براش صورت','','DEMO-BRSH-01','ابزار'],[106,1005,'رژ گونه کرمی','هلویی','DEMO-BLSH-01','آرایش صورت']])p.push(await make('product',{product_id,variation_id,name,variant,sku,category}));
  // Opening bank balance via manual posted journal; synthetic inventory receipts via purchases/opening.
  const j=await make('journal',{ref:'DEMO-OPEN-BANK',date:'2026-11-15',description:'افتتاحیه بانک نمونه',lines:[{account:'1010',debit:80000000,credit:0},{account:'3010',debit:0,credit:80000000}]});
  await make('journal_transition',{id:j,status:'approved'});await make('journal_transition',{id:j,status:'posted'});
  for(let i=0;i<7;i++)await make('purchase',{ref:'DEMO-P'+String(i+1).padStart(3,'0'),date:'2026-11-16',party:i%2?s2:s1,product:p[i],quantity:20+i*3,subtotal:(20+i*3)*(195000+i*27000),shipping:120000,discount:50000,note:'رسید خرید ساختگی نمونه'});
  await make('opening_ref',{product:p[7],quantity:16,evidence:'تصویر نمونه شمارش؛ بدون فاکتور خرید'});
  const saleIds=[];const customers=[c1,c2,c3,c4];
  for(let i=0;i<12;i++){const date=i<4?'2026-11-18':i<8?prev:d,qty=1+i%3;const sale=await make('sale',{ref:'DEMO-WC-'+(100+i),date,party:customers[i%4],product:p[i%7],quantity:qty,subtotal:qty*(485000+i*23000),discount:30000+i*2500,shipping:i%3===0?150000:0,tax:0,channel:i%4===0?'shopino':'online',note:'سفارش تکمیل‌شده ساختگی'});saleIds.push(sale);if(i<9)await make('payment',{ref:'DEMO-PAY-'+i,date,party:customers[i%4],amount:qty*(485000+i*23000)-(30000+i*2500)+(i%3===0?150000:0),channel:['1310','1320','1330','1340'][i%4],note:'رسید تراکنش ساختگی'});}
  await make('sale_return',{ref:'DEMO-RET-01',date:d,related:saleIds[2],note:'برگشت کامل نمونه'});
  await make('refund_payment',{ref:'DEMO-REFUND-01',date:d,party:c3,amount:1558000,channel:'1330',note:'استرداد نمونه؛ بررسی مبلغ در تطبیق'});
  await make('settlement',{ref:'DEMO-SET-01',date:d,gateway:'1310',gross:700000,net:679000,fee:21000,channel:'1010',note:'صورتحساب بانکی ساختگی BATCH-01'});
  await make('settlement',{ref:'DEMO-SET-02',date:d,gateway:'1320',gross:1200000,net:1164000,fee:36000,channel:'1010',note:'صورتحساب بانکی ساختگی BATCH-02'});
  await make('supplier_payment',{ref:'DEMO-SUPPAY-01',date:d,party:s1,amount:6000000,channel:'1010',note:'پرداخت آزمایشی'});
  for(const [i,account,amount,note] of [[1,'5030',950000,'ارسال بسته‌های نمونه'],[2,'5040',1800000,'تبلیغ آزمایشی'],[3,'5090',330000,'ملزومات بسته‌بندی']])await make('expense',{ref:'DEMO-EXP-'+i,date:d,amount,account,channel:'1010',note});
  await make('damage',{ref:'DEMO-DAMAGE-01',date:d,product:p[0],quantity:1,note:'خرابی بسته‌بندی نمونه'});
  await make('exception',{type:'gateway_settlement',ref:'DEMO-REC-01',expected:1500000,observed:1450000,description:'اختلاف صورت‌حساب درگاه و بانک؛ نیازمند مدرک'});
  await make('exception',{type:'payment',ref:'DEMO-REC-02',expected:500000,observed:500000,description:'مبالغ نمونه برابر؛ پس از رؤیت مدرک قابل رفع'});
  await make('exception',{type:'stock',ref:'DEMO-REC-03',expected:22,observed:21,description:'مغایرت شمارش نمونه با دفتر موجودی'});
  await make('journal',{ref:'DEMO-DRAFT-01',date:d,description:'پیش‌نویس هزینه آزمایشی برای بررسی',lines:[{account:'5090',debit:75000,credit:0},{account:'1010',debit:0,credit:75000}]});
  return {products:p.length,sales:saleIds.length};
}
