type Invitation = { id:string;email:string;name:string;emailStatus:string }
type Dependencies = {
  appUrl:string
  authenticate:(token:string)=>Promise<string|null>
  prepare:(token:string,input:{email:string;name:string;branchId:string})=>Promise<Invitation>
  send:(email:string,redirectTo:string)=>Promise<'sent'|'existing_account'>
  finish:(id:string,actor:string,status:'sent'|'failed'|'existing_account')=>Promise<void>
}
export function createInviteHandler(deps:Dependencies){
  const appOrigin=new URL(deps.appUrl).origin
  return async(request:Request)=>{
    const origin=request.headers.get('origin')
    const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':appOrigin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
    const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
    if(origin&&origin!==appOrigin)return reply({message:'This origin is not allowed'},403)
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
    if(request.method!=='POST')return reply({message:'Method not allowed'},405)
    const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if(!token)return reply({message:'Sign in to invite staff'},401)
    let actor:string|null
    try{actor=await deps.authenticate(token)}catch{return reply({message:'Your session could not be verified. Try again.'},503)}
    if(!actor)return reply({message:'Your session could not be verified. Sign in again.'},401)
    let invitation:Invitation
    try{
      const input=await request.json()
      if(typeof input.email!=='string'||typeof input.name!=='string'||typeof input.branchId!=='string')return reply({message:'Enter a name, email and cafe'},400)
      invitation=await deps.prepare(token,{email:input.email,name:input.name,branchId:input.branchId})
    }catch(error){
      const code=error&&typeof error==='object'&&'code' in error?error.code:''
      return reply({message:code==='42501'?'Only the owner can invite staff.':'The invitation could not be saved. Check the details and try again.'},code==='42501'?403:400)
    }
    if(invitation.emailStatus==='sent'||invitation.emailStatus==='existing_account')return reply({invitationId:invitation.id,delivery:invitation.emailStatus,message:'This invitation is already pending. The person can sign in and join your cafe.'})
    let delivery:'sent'|'existing_account'
    try{delivery=await deps.send(invitation.email,appOrigin)}catch{
      try{await deps.finish(invitation.id,actor,'failed')}catch{}
      return reply({invitationId:invitation.id,saved:true,message:'The invitation is saved, but the email could not be sent. Check Auth email delivery or ask the person to sign in with the invited address.'},502)
    }
    let statusRecorded=true
    try{await deps.finish(invitation.id,actor,delivery)}catch{statusRecorded=false}
    return reply({invitationId:invitation.id,delivery,statusRecorded,message:delivery==='sent'?'Invitation email sent. Staff will join this cafe after verifying their email.':'This person already has a login. Ask them to sign in and accept the cafe invitation.'})
  }
}
