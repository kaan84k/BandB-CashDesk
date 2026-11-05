import { addDays, today, validateSnapshot, type Snapshot } from './domain'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const DEMO_USER = { id:uid(1), name:'Anjali Perera', email:'anjali@example.com', role:'owner' as const }
export function createDemo(): Snapshot {
  const d = today()
  const branches = [ {id:uid(10), name:'Colombo cafe', location:'Books & Buns · Colombo'}, {id:uid(11), name:'Bakery production', location:'Books & Buns · Production'} ]
  const accounts = [
    {id:uid(20),branchId:uid(10),name:'Main current account',type:'bank' as const,bank:'Commercial Bank',openingBalance:58000000},
    {id:uid(21),branchId:uid(10),name:'Business savings',type:'bank' as const,bank:'Sampath Bank',openingBalance:21000000},
    {id:uid(22),branchId:uid(10),name:'Cafe cash till',type:'cash' as const,bank:'',openingBalance:5200000},
    {id:uid(23),branchId:uid(11),name:'Bakery petty cash',type:'petty' as const,bank:'',openingBalance:850000},
  ]
  const suppliers = [
    {id:uid(30),branchId:uid(10),name:'Serendib Flour Mills',contact:'Nimal Fernando',phone:'+94 11 555 0101',email:'flour@example.com',terms:30},
    {id:uid(31),branchId:uid(10),name:'EcoPack Lanka',contact:'Dilini Silva',phone:'+94 77 555 0102',email:'packaging@example.com',terms:14},
    {id:uid(32),branchId:uid(10),name:'Highland Dairy',contact:'Kasun Jayasuriya',phone:'+94 71 555 0103',email:'dairy@example.com',terms:14},
    {id:uid(33),branchId:uid(10),name:'Ceylon Spice Co.',contact:'Ravi Senanayake',phone:'+94 76 555 0104',email:'spices@example.com',terms:7},
    {id:uid(34),branchId:uid(11),name:'The Baking Store',contact:'Amali Dias',phone:'+94 77 555 0105',email:'baking@example.com',terms:14},
  ]
  const cheques: Snapshot['cheques'] = [
    {id:uid(40),branchId:uid(10),accountId:uid(20),number:'001254',type:'issued',payee:suppliers[0].name,supplierId:uid(30),bank:'Commercial Bank',amount:12500000,issueDate:addDays(d,-4),dueDate:addDays(d,2),status:'issued',notes:'November flour delivery'},
    {id:uid(41),branchId:uid(10),accountId:uid(20),number:'001255',type:'issued',payee:suppliers[1].name,supplierId:uid(31),bank:'Commercial Bank',amount:8500000,issueDate:addDays(d,-3),dueDate:addDays(d,5),status:'issued',notes:'Takeaway packaging'},
    {id:uid(42),branchId:uid(10),accountId:uid(20),number:'001256',type:'issued',payee:suppliers[2].name,supplierId:uid(32),bank:'Commercial Bank',amount:6500000,issueDate:addDays(d,-2),dueDate:addDays(d,9),status:'issued',notes:''},
    {id:uid(43),branchId:uid(10),accountId:uid(21),number:'008412',type:'received',payee:'The Little Market',supplierId:null,bank:'Hatton National Bank',amount:7500000,issueDate:addDays(d,-1),dueDate:addDays(d,3),status:'received',notes:'Packed cookies wholesale order'},
    {id:uid(44),branchId:uid(10),accountId:uid(20),number:'001253',type:'issued',payee:suppliers[2].name,supplierId:uid(32),bank:'Commercial Bank',amount:3200000,issueDate:addDays(d,-12),dueDate:addDays(d,-3),status:'cleared',notes:'Previous dairy delivery'},
    {id:uid(45),branchId:uid(10),accountId:uid(20),number:'001252',type:'issued',payee:suppliers[3].name,supplierId:uid(33),bank:'Commercial Bank',amount:1800000,issueDate:addDays(d,-9),dueDate:addDays(d,-2),status:'returned',notes:'Follow up with bank before re-presenting'},
    {id:uid(46),branchId:uid(10),accountId:uid(20),number:'001251',type:'issued',payee:'Office supplies',supplierId:null,bank:'Commercial Bank',amount:1450000,issueDate:addDays(d,-12),dueDate:addDays(d,-5),status:'cancelled',notes:'Order cancelled'},
  ]
  const sales = [36500,42800,38900,48600,57100,52250,44600,39800,46500,58400,49200,63750,55800,28650]
  const costs = [9200,15600,8400,24500,11300,18400,6800,14900,27300,10100,32000,22350,12800,8400]
  const transactions: Snapshot['transactions'] = []
  for (let i=0;i<14;i++) {
    const day = addDays(d,i-13)
    transactions.unshift({id:uid(100+i),branchId:uid(10),accountId:i%3===0?uid(22):uid(20),type:'income',amount:sales[i]*100,category:i%4===0?'Packed cookies':'Cafe sales',description:i===13?'Morning cafe sales':i%4===0?'Cookie box orders':'Daily cafe sales',date:day,supplierId:null,chequeId:null,method:i%3===0?'cash':'card'})
    if(i!==10) transactions.unshift({id:uid(200+i),branchId:uid(10),accountId:uid(20),type:'expense',amount:costs[i]*100,category:i===13?'Ingredients':i%3===0?'Ingredients':i%3===1?'Utilities':'Packaging',description:i===13?'Fresh produce & ingredients':i%3===0?'Kitchen ingredients':i%3===1?'Cafe utilities':'Cups & takeaway packaging',date:day,supplierId:null,chequeId:null,method:'transfer'})
  }
  transactions.push({id:uid(250),branchId:uid(10),accountId:uid(20),type:'expense',amount:3200000,category:'Cheque settlement',description:'Cheque #001253 · Highland Dairy',date:addDays(d,-3),supplierId:uid(32),chequeId:uid(44),method:'cheque'})
  transactions.unshift({id:uid(251),branchId:uid(11),accountId:uid(23),type:'expense',amount:185000,category:'Ingredients',description:'Bakery baking essentials',date:d,supplierId:uid(34),chequeId:null,method:'cash'})
  const invoices: Snapshot['invoices'] = suppliers.map((s,i)=>({id:uid(300+i),branchId:s.branchId,supplierId:s.id,reference:`INV-2026-${101+i}`,amount:[12500000,8500000,9700000,1800000,460000][i],date:addDays(d,-5-i),dueDate:addDays(d,[2,5,9,-2,7][i])}))
  return validateSnapshot({version:1,branches,accounts,transactions,cheques,suppliers,invoices,members:[DEMO_USER,{id:uid(2),name:'Kasun Silva',email:'kasun@example.com',role:'manager'},{id:uid(3),name:'Dinithi Fernando',email:'dinithi@example.com',role:'staff'}],audit:[{id:uid(400),action:'addCheque',entityId:uid(40),at:new Date().toISOString(),actor:DEMO_USER.name}]})
}
