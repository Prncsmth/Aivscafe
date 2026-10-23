import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Field, Modal } from '@/components/ui';

// The POS passes a new onClose on every render; typing must not move focus back to the first field.
function NotesDialog() {
  const [size, setSize] = useState('Small');
  const [notes, setNotes] = useState('');
  return (
    <Modal open onClose={() => setNotes('')} title="Okinawa Milk Tea">
      <button onClick={() => setSize('Large')}>{size}</button>
      <Field label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  );
}

describe('Modal', () => {
  it('keeps focus in the field while typing', () => {
    render(<NotesDialog />);
    const input = screen.getByLabelText('Notes') as HTMLInputElement;
    input.focus();
    let text = '';
    for (const ch of 'less sugar') {
      text += ch;
      fireEvent.change(input, { target: { value: text } });
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe('less sugar');
  });
});
