'use strict';
// Keep the default machine CSV stable; display exports use explicit headers and major units.
const headings={
  barcode:['Barcode','บาร์โค้ด'],product_name:['Product name','ชื่อสินค้า'],quantity:['Quantity','จำนวน'],created:['Recorded at','เวลาที่บันทึก'],
  id:['Record ID','เลขรายการ'],sku:['SKU','รหัสสินค้า'],name:['Name','ชื่อ'],price:['Selling price','ราคาขาย'],cost:['Reference cost','ต้นทุนอ้างอิง'],stock:['Stock quantity','จำนวนคงเหลือ'],reorder:['Reorder point','จุดสั่งซื้อเพิ่ม'],active:['Status','สถานะ'],version:['Record version','รุ่นข้อมูล'],kind:['Contact type','ประเภทผู้ติดต่อ'],email:['Email','อีเมล'],phone:['Phone','เบอร์โทร'],address:['Address','ที่อยู่'],
  customer_id:['Customer ID','รหัสลูกค้า'],customer_name:['Customer name','ชื่อลูกค้า'],customer_address:['Customer address','ที่อยู่ลูกค้า'],business_name:['Business name','ชื่อธุรกิจ'],business_address:['Business address','ที่อยู่ธุรกิจ'],currency:['Currency','สกุลเงิน'],issued:['Issue date','วันที่ออก'],due:['Due date','วันครบกำหนด'],subtotal:['Subtotal','ยอดก่อนภาษี'],tax_bps:['Tax rate (%)','อัตราภาษี (%)'],tax:['Tax amount','ภาษี'],total:['Total','ยอดรวม'],paid:['Paid amount','ยอดรับชำระ'],balance:['Balance due','ยอดค้างชำระ'],status:['Status','สถานะ'],note:['Note','หมายเหตุ'],
  invoice_id:['Invoice ID','เลขใบแจ้งหนี้'],amount:['Amount','จำนวนเงิน'],date:['Date / time','วันที่ / เวลา'],reference:['Reference','เลขอ้างอิง'],supplier_id:['Supplier ID','รหัสผู้ขาย'],supplier_name:['Supplier name','ชื่อผู้ขาย'],category:['Category','หมวดหมู่'],payee:['Payee','ผู้รับเงิน'],voided:['Status','สถานะ'],product_id:['Product ID','รหัสรายการสินค้า'],delta:['Stock change','จำนวนที่เปลี่ยน'],reason:['Reason','เหตุผล'],user_id:['User ID','รหัสผู้ใช้'],action:['Action','การทำรายการ'],entity:['Record','รายการ'],detail:['Details','รายละเอียด']
};
const statuses={customer:['Customer','ลูกค้า'],supplier:['Supplier','ผู้ขาย'],issued:['Issued','ออกใบแจ้งหนี้แล้ว'],unpaid:['Unpaid','ยังไม่ชำระ'],partial:['Partially paid','ชำระบางส่วน'],paid:['Paid','ชำระแล้ว'],overdue:['Overdue','เกินกำหนด'],void:['Void','ยกเลิก'],ordered:['Awaiting delivery','รอรับสินค้า'],received:['Received','รับสินค้าแล้ว'],cancelled:['Cancelled','ยกเลิกแล้ว']};
const categories={'Inventory purchases':'ซื้อสินค้าเข้าสต็อก',Rent:'ค่าเช่า',Utilities:'ค่าน้ำ ค่าไฟ และสาธารณูปโภค',Payroll:'เงินเดือนและค่าจ้าง',Transport:'ค่าขนส่ง',Marketing:'การตลาด',Equipment:'อุปกรณ์',Other:'อื่น ๆ'};
const moneyColumns=new Set(['price','cost','subtotal','tax','total','paid','amount','balance']);
function displayReport(table,rows,columns,{language='en',currency='THB',today}){
  const lang=language==='th'?1:0;
  const keys=columns.filter(k=>k!=='version');if(table==='invoices')keys.push('balance');
  const headers=keys.map(k=>{const name=headings[k]?.[lang]||k;return moneyColumns.has(k)?`${name} (${currency})`:name;});
  const data=rows.map(row=>keys.map(k=>{
    let value=row[k];
    if(k==='balance')value=row.status==='void'?0:row.total-row.paid;
    if(moneyColumns.has(k))return (value/100).toFixed(2);
    if(k==='tax_bps')return (value/100).toFixed(2);
    if(k==='active')return value?(lang?'ใช้งาน':'Active'):(lang?'หยุดใช้งาน':'Archived');
    if(k==='voided')return value?(lang?'ยกเลิก':'Void'):(lang?'บันทึกแล้ว':'Recorded');
    if(k==='status'&&table==='invoices'&&value!=='void')value=row.paid===row.total?'paid':row.due<today?'overdue':row.paid?'partial':'unpaid';
    if(k==='category'&&lang&&Object.hasOwn(categories,value))return categories[value];
    if(k==='status'||k==='kind')return statuses[value]?.[lang]||value;
    return value;
  }));
  return {headers,rows:data};
}
module.exports={displayReport};
