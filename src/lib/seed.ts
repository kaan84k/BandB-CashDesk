import { addDays, balanceOn, today, validateSnapshot, type Snapshot } from './domain'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const DEMO_USER={id:uid(1),name:'Anjali Perera',email:'anjali@example.com',role:'owner' as const}
export function createDemo():Snapshot {
  const d=today(),branchId=uid(10)
  const accounts:Snapshot['accounts']=[
    {id:uid(22),branchId,name:'Cash drawer',type:'cash',bank:'',openingBalance:5200000},
    {id:uid(20),branchId,name:'Bank account',type:'bank',bank:'Commercial Bank',openingBalance:58000000},
    {id:uid(23),branchId,name:'Personal safe',type:'safe',bank:'',openingBalance:21000000},
  ]
  // Legacy supplier references are retained for historical cheque integrity only.
  const suppliers:Snapshot['suppliers']=[
    {id:uid(30),branchId,name:'Daily Bakes',contact:'Nimal',phone:'',email:'bakes@example.com',terms:30},
    {id:uid(31),branchId,name:'EcoPack Lanka',contact:'Dilini',phone:'',email:'packaging@example.com',terms:14},
    {id:uid(32),branchId,name:'Highland Dairy',contact:'Kasun',phone:'',email:'dairy@example.com',terms:14},
    {id:uid(33),branchId,name:'Ceylon Coffee Co.',contact:'Ravi',phone:'',email:'coffee@example.com',terms:7},
  ]
  const cheques:Snapshot['cheques']=[
    {id:uid(40),branchId,accountId:uid(20),number:'001254',type:'issued',payee:suppliers[0].name,supplierId:uid(30),bank:'Commercial Bank',amount:12500000,issueDate:addDays(d,-4),dueDate:addDays(d,2),status:'issued',notes:'Products bought for resale'},
    {id:uid(41),branchId,accountId:uid(20),number:'001255',type:'issued',payee:suppliers[1].name,supplierId:uid(31),bank:'Commercial Bank',amount:8500000,issueDate:addDays(d,-3),dueDate:addDays(d,5),status:'issued',notes:'Takeaway packaging'},
    {id:uid(42),branchId,accountId:uid(20),number:'001256',type:'issued',payee:suppliers[2].name,supplierId:uid(32),bank:'Commercial Bank',amount:6500000,issueDate:addDays(d,-2),dueDate:addDays(d,9),status:'issued',notes:''},
    {id:uid(43),branchId,accountId:uid(20),number:'008412',type:'received',payee:'Office catering customer',supplierId:null,bank:'Hatton National Bank',amount:7500000,issueDate:addDays(d,-1),dueDate:addDays(d,3),status:'received',notes:'Customer payment'},
    {id:uid(44),branchId,accountId:uid(20),number:'001253',type:'issued',payee:suppliers[2].name,supplierId:uid(32),bank:'Commercial Bank',amount:3200000,issueDate:addDays(d,-12),dueDate:addDays(d,-3),status:'cleared',notes:'Previous dairy delivery'},
    {id:uid(45),branchId,accountId:uid(20),number:'001252',type:'issued',payee:suppliers[3].name,supplierId:uid(33),bank:'Commercial Bank',amount:1800000,issueDate:addDays(d,-9),dueDate:addDays(d,-2),status:'returned',notes:'Confirm with the bank before re-presenting'},
    {id:uid(46),branchId,accountId:uid(20),number:'001251',type:'issued',payee:'Office supplies',supplierId:null,bank:'Commercial Bank',amount:1450000,issueDate:addDays(d,-12),dueDate:addDays(d,-5),status:'cancelled',notes:'Order cancelled'},
  ]
  const sales=[36500,42800,38900,48600,57100,52250,44600,39800,46500,58400,49200,63750,55800,28650],costs=[9200,15600,8400,24500,11300,18400,6800,14900,27300,10100,32000,22350,12800,8400]
  const transactions:Snapshot['transactions']=[]
  for(let i=0;i<14;i++){
    const date=addDays(d,i-13)
    transactions.unshift({id:uid(100+i),branchId,accountId:i%4===0?uid(20):uid(22),type:'income',amount:sales[i]*100,category:'Sales',description:i===13?'Morning sales':'Daily sales',date,supplierId:null,chequeId:null,method:i%4===0?'card':'cash'})
    if(i!==10)transactions.unshift({id:uid(200+i),branchId,accountId:uid(22),type:'expense',amount:costs[i]*100,category:i%3===1?'Electricity & water':'Supplier purchase',description:i===13?'Products bought from supplier':i%3===1?'Business utilities':'Products bought for resale',date,supplierId:null,chequeId:null,method:'cash'})
  }
  transactions.push({id:uid(250),branchId,accountId:uid(20),type:'expense',amount:3200000,category:'Cheque settlement',description:'Cheque #001253 · Highland Dairy',date:addDays(d,-3),supplierId:uid(32),chequeId:uid(44),method:'cheque'})
  const transfers:Snapshot['transfers']=[{id:uid(500),branchId,fromAccountId:uid(22),toAccountId:uid(20),amount:5000000,date:addDays(d,-1),description:'Cash deposited at the bank'},{id:uid(501),branchId,fromAccountId:uid(22),toAccountId:uid(23),amount:1000000,date:d,description:'Cash kept in personal safe'}]
  transfers.forEach((t,i)=>{for(const type of ['expense','income'] as const)transactions.unshift({id:uid(510+i*2+(type==='income'?1:0)),branchId,accountId:type==='expense'?t.fromAccountId:t.toAccountId,type,amount:t.amount,category:'Money transfer',description:t.description,date:t.date,method:'transfer',supplierId:null,chequeId:null,transferId:t.id})})
  const cashDays:Snapshot['cashDays']=Array.from({length:14},(_,i)=>{const date=addDays(d,i-13),drawer=accounts[0];return{id:uid(600+i),branchId,accountId:drawer.id,date,opening:balanceOn(drawer,transactions,date,true),openingLedger:balanceOn(drawer,transactions,date,true),closing:i===13?null:balanceOn(drawer,transactions,date),expectedClosing:i===13?null:balanceOn(drawer,transactions,date),notes:''}})
  const invoices=suppliers.map((s,i)=>({id:uid(300+i),branchId,supplierId:s.id,reference:`INV-${101+i}`,amount:[12500000,8500000,9700000,1800000][i],date:addDays(d,-5-i),dueDate:addDays(d,[2,5,9,-2][i])}))
  return validateSnapshot({version:1,companyName:'Example business',branches:[{id:branchId,name:'Main location',location:'Colombo'}],accounts,transactions,cheques,suppliers,invoices,transfers,cashDays,members:[DEMO_USER,{id:uid(2),name:'Kasun Silva',email:'kasun@example.com',role:'manager'},{id:uid(3),name:'Dinithi Fernando',email:'dinithi@example.com',role:'staff'}],audit:[{id:uid(400),action:'openDay',entityId:cashDays.at(-1)!.id,at:new Date().toISOString(),actor:DEMO_USER.name}]})
}
