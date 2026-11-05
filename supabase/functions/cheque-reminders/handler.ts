type Delivery={id:string;token:string;key:string;recipients:string[];sender:string;payee:string;number:string;amount:number;dueDate:string;type:string;stage:string}
type Database={rpc:(name:string,args?:Record<string,unknown>)=>Promise<{data:Delivery[]|null;error:unknown}>}
type Dependencies={env:(name:string)=>string|undefined;database:(url:string,key:string)=>Database;fetch:typeof fetch}

async function sameSecret(a:string,b:string){
  const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))
  const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0
}
export function createReminderHandler(deps:Dependencies){return async(request:Request)=>{
  if(request.method!=='POST')return new Response('Method not allowed',{status:405})
  const expected=deps.env('REMINDER_CRON_SECRET'),provided=request.headers.get('x-cron-secret')??''
  if(!expected||!await sameSecret(provided,expected))return new Response('Unauthorised',{status:401})
  const resendKey=deps.env('RESEND_API_KEY'),url=deps.env('SUPABASE_URL'),serviceKey=deps.env('SUPABASE_SERVICE_ROLE_KEY')
  if(!resendKey||!url||!serviceKey)return Response.json({error:'Reminder service is not configured'},{status:503})
  const db=deps.database(url,serviceKey)
  const {data:deliveries,error}=await db.rpc('claim_due_reminders')
  if(error)return Response.json({error:'Could not claim reminder deliveries'},{status:500})
  let sent=0,failed=0
  const started=Date.now()
  for(const item of deliveries??[]){
    let provider:string|null=null,failure:string|null=null
    try{
      if(Date.now()-started>100000)throw new Error('Batch time budget reached; delivery is eligible for retry')
      // Remain below the default provider limit of two requests per second.
      if(sent+failed>0)await new Promise(resolve=>setTimeout(resolve,600))
      const response=await deps.fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':item.key},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:item.sender,to:item.recipients,subject:`B&B CashDesk · cheque #${item.number} · ${item.stage}`,text:`${item.type==='issued'?'Payment to':'Receipt from'} ${item.payee}\nCheque: ${item.number}\nAmount: LKR ${Number(item.amount).toLocaleString('en-LK',{minimumFractionDigits:2})}\nDue: ${item.dueDate} (Asia/Colombo)\nReminder: ${item.stage}\n\nPlease confirm the bank status in CashDesk. This reminder does not move any money.`})})
      if(!response.ok)throw new Error(`Email provider returned HTTP ${response.status}`)
      const body=await response.json();provider=body.id
      if(!provider)throw new Error('Email provider did not confirm a delivery ID')
    }catch(e){failure=e instanceof Error?e.message:'Email delivery failed'}
    const {error:finishError}=await db.rpc('finish_reminder',{delivery_id:item.id,token:item.token,delivered:!failure,provider,failure})
    if(failure||finishError)failed++;else sent++
  }
  return Response.json({claimed:deliveries?.length??0,sent,failed},{status:failed?502:200})
}}
