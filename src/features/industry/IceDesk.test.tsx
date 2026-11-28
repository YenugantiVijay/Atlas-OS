import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {IceDesk} from './IceDesk';
import type {Snapshot} from './operations';
const data=(quantity:number):Snapshot=>({today:'2026-11-28',series:[],tills:[],events:[],stock:[{site:'STALL 1',sku:'VANILLA',batch:'',unit:'piece',quantity,expiry:null}]});
describe('Physical stock count baseline',()=>{
 it('does not silently rebase an entered count when fresh stock data arrives',async()=>{
  const user=userEvent.setup();const save=vi.fn().mockResolvedValue(false);const view=render(<IceDesk snapshot={data(10)} save={save} busy={false} canWrite distribution={false} role="owner"/>);
  await user.click(screen.getByRole('button',{name:'Count closing stock'}));await user.type(screen.getByLabelText('Stall name',{exact:true}),'STALL 1');await user.type(screen.getByLabelText('Product SKU or flavor'),'VANILLA');await user.type(screen.getByLabelText('Counted quantity'),'8');await user.type(screen.getByLabelText('Stock adjustment reason (at least 5 characters)'),'Physical closing count');
  view.rerender(<IceDesk snapshot={data(15)} save={save} busy={false} canWrite distribution={false} role="owner"/>);await user.click(screen.getByRole('button',{name:'Save stock count'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({quantity:8,expected_quantity:10})));
  await user.click(screen.getByRole('button',{name:'Start a fresh count'}));await user.type(screen.getByLabelText('Counted quantity'),'13');await user.type(screen.getByLabelText('Stock adjustment reason (at least 5 characters)'),'Recount after delivery');await user.click(screen.getByRole('button',{name:'Save stock count'}));await waitFor(()=>expect(save).toHaveBeenLastCalledWith(expect.objectContaining({quantity:13,expected_quantity:15})));
 });
});
