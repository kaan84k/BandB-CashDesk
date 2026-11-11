import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { createInviteHandler } from './handler.ts'

const url=Deno.env.get('SUPABASE_URL')!
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(createInviteHandler({
  appUrl:Deno.env.get('APP_URL')??'https://band-b-cash-desk.vercel.app',
  authenticate:async token=>{const {data,error}=await admin.auth.getUser(token);return error?null:data.user?.id??null},
  prepare:async(token,input)=>{
    const caller=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}})
    const {data,error}=await caller.rpc('cashdesk_prepare_invitation',{staff_email:input.email,staff_name:input.name,cafe_branch:input.branchId})
    if(error)throw error
    return data
  },
  send:async(email,redirectTo)=>{
    const {error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo})
    if(error){if(error.code==='email_exists'||/already.*registered|already.*exists/i.test(error.message))return 'existing_account';throw error}
    return 'sent'
  },
  finish:async(id,actor,status)=>{const {error}=await admin.rpc('cashdesk_finish_invitation',{invitation_id:id,actor,delivery:status});if(error)throw error},
}))
