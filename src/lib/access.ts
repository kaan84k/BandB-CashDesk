import { z } from 'zod'
const id=z.string().uuid()
export const entryContextSchema=z.object({
  role:z.literal('staff'),
  user:z.object({id,name:z.string(),email:z.email(),role:z.literal('staff')}).strict(),
  cafe:z.object({id,name:z.string()}).strict(),
  branches:z.array(z.object({id,name:z.string()}).strict()).min(1),
  accounts:z.array(z.object({id,branchId:id,name:z.string(),type:z.enum(['bank','cash','safe','petty']),bank:z.string()}).strict()),
  days:z.array(z.object({id,accountId:id,date:z.string(),status:z.enum(['open','closed'])}).strict()),
}).strict()
export type EntryContext=z.infer<typeof entryContextSchema>
export type PendingInvitation={id:string;companyName:string;invitedBy:string}
export function canReadFinance(role:string|undefined){return role==='owner'||role==='manager'}
