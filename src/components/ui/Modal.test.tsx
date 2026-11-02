import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';
import { Input } from './Input';
import { Select } from './Select';

describe('Dialog keyboard and scroll behavior', () => {
  it('traps focus, survives rerenders, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      const [value, setValue] = useState('');
      return <>
        <button onClick={() => setOpen(true)}>Open editor</button>
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Editor">
          <Input label="Name" value={value} onChange={event => setValue(event.target.value)} />
          <button>Save</button>
        </Modal>
        <Modal isOpen={false} onClose={() => {}} title="Closed sibling">Hidden</Modal>
      </>;
    }
    document.body.style.overflow = 'auto';
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Open editor' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Editor' });
    expect(document.body.style.overflow).toBe('hidden');
    const last = within(dialog).getByRole('button', { name: 'Save' });
    last.focus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.type(screen.getByLabelText('Name'), 'Updated');
    expect(screen.getByLabelText('Name')).toHaveValue('Updated');
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('closes only the top dialog and keeps the parent scroll lock', () => {
    function Example() {
      const [child, setChild] = useState(true);
      return <>
        <Modal isOpen onClose={() => {}} title="Parent"><button>Parent action</button></Modal>
        <Modal isOpen={child} onClose={() => setChild(false)} title="Child"><button>Child action</button></Modal>
      </>;
    }
    const view = render(<Example />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Child' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('assigns distinct IDs to repeated labels and associates each error', () => {
    render(<>
      <Input label="Name" error="First error" />
      <Input label="Name" error="Second error" />
      <Select label="Status" options={[{ value: 'open', label: 'Open' }]} />
      <Select label="Status" options={[{ value: 'open', label: 'Open' }]} />
    </>);
    const inputs = screen.getAllByLabelText('Name');
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[0]).toHaveAccessibleDescription('First error');
    expect(inputs[1]).toHaveAccessibleDescription('Second error');
    const selects = screen.getAllByLabelText('Status');
    expect(selects[0].id).not.toBe(selects[1].id);
  });
});
