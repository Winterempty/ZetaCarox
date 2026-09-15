'use strict';
// Operational trends from recorded activity only. No tax or accounting-profit inference.
function monthKey(date){return date.slice(0,7);}
function shiftMonth(key,offset){const [y,m]=key.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7);}
function compare(current,previous,currentCount,previousCount,metric){
  if(!previousCount)return {status:'no-history',delta:null,percent:null,tone:'neutral'};
  if(!currentCount)return {status:'no-current',delta:null,percent:null,tone:'neutral'};
  const delta=current-previous,status=delta>0?'up':delta<0?'down':'flat';
  // A percentage from zero or a negative cash balance would be misleading.
  const percent=previous>0?Math.round(delta/previous*1000)/10:null;
  const tone=metric==='expenses'||!delta?'neutral':delta>0?'good':'bad';
  return {status,delta,percent,tone};
}
function businessHealth({invoices,payments,expenses,products,today}){
  const currentKey=monthKey(today);
  const months=Array.from({length:6},(_,i)=>({month:shiftMonth(currentKey,i-6),sales:0,payments:0,expenses:0,cash:0,counts:{sales:0,payments:0,expenses:0,cash:0}}));
  const current={month:currentKey,sales:0,payments:0,expenses:0,cash:0,counts:{sales:0,payments:0,expenses:0,cash:0}};
  const byMonth=new Map([...months,current].map(m=>[m.month,m]));
  const active=invoices.filter(i=>i.status!=='void');
  for(const i of active){const m=byMonth.get(monthKey(i.issued));if(m&&i.issued<=today){m.sales+=i.subtotal;m.counts.sales++;}}
  for(const p of payments){const m=byMonth.get(monthKey(p.date));if(m&&p.date<=today){m.payments+=p.amount;m.counts.payments++;}}
  for(const e of expenses){const m=byMonth.get(monthKey(e.date));if(m&&!e.voided&&e.date<=today){m.expenses+=e.amount;m.counts.expenses++;}}
  for(const m of [...months,current]){m.cash=m.payments-m.expenses;m.counts.cash=m.counts.payments+m.counts.expenses;}
  const previous=months[4],latest=months[5],comparisons={};
  for(const key of ['sales','payments','expenses','cash'])comparisons[key]=compare(latest[key],previous[key],latest.counts[key],previous.counts[key],key);
  const overdue=active.filter(i=>i.paid<i.total&&i.due<today).sort((a,b)=>a.due.localeCompare(b.due));
  const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);const endDay=end.toISOString().slice(0,10);
  const soon=active.filter(i=>i.paid<i.total&&i.due>=today&&i.due<=endDay);
  const low=products.filter(p=>p.active&&p.stock<=p.reorder).sort((a,b)=>a.stock-b.stock||a.id-b.id);
  const belowCost=products.filter(p=>p.active&&p.cost>0&&p.price<p.cost);
  const zeroCost=products.filter(p=>p.active&&p.cost===0);
  const actions=[];
  if(overdue.length)actions.push({kind:'overdue',severity:'high',count:overdue.length,amount:overdue.reduce((n,i)=>n+i.total-i.paid,0),recordId:overdue[0].id,view:'invoices'});
  if(low.length)actions.push({kind:'stock',severity:low.some(p=>p.stock===0)?'high':'medium',count:low.length,view:'inventory'});
  if(belowCost.length)actions.push({kind:'pricing',severity:'medium',count:belowCost.length,view:'inventory'});
  if(latest.counts.cash&&latest.cash<0)actions.push({kind:'cash',severity:'medium',amount:-latest.cash,view:'expenses'});
  if(comparisons.sales.status==='down')actions.push({kind:'sales',severity:'medium',percent:comparisons.sales.percent,amount:-comparisons.sales.delta,view:'invoices'});
  if(soon.length)actions.push({kind:'due-soon',severity:'normal',count:soon.length,amount:soon.reduce((n,i)=>n+i.total-i.paid,0),view:'invoices'});
  if(zeroCost.length)actions.push({kind:'costs',severity:'normal',count:zeroCost.length,view:'inventory'});
  if(!latest.counts.sales||!previous.counts.sales)actions.push({kind:'history',severity:'normal',view:'invoices'});
  const categoryTotals=new Map();for(const e of expenses)if(!e.voided&&monthKey(e.date)===latest.month)categoryTotals.set(e.category,(categoryTotals.get(e.category)||0)+e.amount);
  const topExpenses=[...categoryTotals].map(([name,amount])=>({name,amount,share:latest.expenses?Math.round(amount/latest.expenses*1000)/10:0})).sort((a,b)=>b.amount-a.amount).slice(0,5);
  return {asOf:today,months,current,latestMonth:latest.month,previousMonth:previous.month,comparisons,actions,topExpenses};
}
module.exports={businessHealth,compare,shiftMonth};
