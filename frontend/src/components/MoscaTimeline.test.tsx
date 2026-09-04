import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoscaTimeline } from './MoscaTimeline';

describe('MoscaTimeline', () => {
  it('calculates a safe buffer from the initial policy values', () => {
    render(<MoscaTimeline initialX={3} initialY={2} initialZ={9} assetIdentifier="asset-safe" />);

    expect(screen.getAllByText('SAFE').length).toBeGreaterThan(0);
    expect(screen.getByText('Safe by 4.0y')).toBeInTheDocument();
    expect(screen.getByText(/asset-safe/)).toBeInTheDocument();
  });

  it('updates to a deficit simulation and can reset', () => {
    render(<MoscaTimeline initialX={7} initialY={2} initialZ={9} />);

    fireEvent.change(screen.getByLabelText('Migration Time (Y)'), { target: { value: '8' } });
    expect(screen.getAllByText('CRITICAL URGENT').length).toBeGreaterThan(0);
    expect(screen.getByText(/Simulation only/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Reset all inputs back to original policy assessment values'));
    expect(screen.getAllByText('WATCH').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Simulation only/)).not.toBeInTheDocument();
  });
});
