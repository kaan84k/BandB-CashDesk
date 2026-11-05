import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { createReminderHandler } from './handler.ts'

Deno.serve(createReminderHandler({
  env:name=>Deno.env.get(name),
  fetch,
  database:(url,key)=>{
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    return {rpc:async(name,args)=>{const {data,error}=await client.rpc(name,args);return {data,error}}}
  },
}))
