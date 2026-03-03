import { confirmIntentConfidence, deriveAssistantState, initialAssistantState } from '../../src/services/assistant-state-machine.js';

describe('assistant-state-machine', () => {
  test('initial state is IDLE', () => {
    const state = initialAssistantState();
    expect(state.state).toBe('IDLE');
  });

  test('moves to scheme disambiguation when ambiguous', () => {
    const next = deriveAssistantState({
      current: initialAssistantState(),
      intent: 'scheme_lookup',
      actionResultType: 'scheme_disambiguation',
      pendingType: 'scheme_disambiguation',
    });
    expect(next.state).toBe('SCHEME_DISAMBIGUATION');
  });

  test('moves to apply submit confirmation after prepare_apply', () => {
    const next = deriveAssistantState({
      current: initialAssistantState(),
      intent: 'apply',
      actionResultType: 'prepare_apply',
      pendingType: 'application_confirm',
    });
    expect(next.state).toBe('APPLY_SUBMIT_CONFIRMATION');
  });

  test('moves to apply document collection when document requirements are missing', () => {
    const next = deriveAssistantState({
      current: initialAssistantState(),
      intent: 'documents',
      actionResultType: 'document_requirements_missing',
      pendingType: null,
    });
    expect(next.state).toBe('APPLY_DOC_COLLECTION');
  });

  test('returns to IDLE after submitted', () => {
    const next = deriveAssistantState({
      current: { ...initialAssistantState(), state: 'APPLY_SUBMIT_CONFIRMATION' },
      intent: 'apply',
      actionResultType: 'submitted',
      pendingType: null,
    });
    expect(next.state).toBe('IDLE');
  });

  test('confirmation confidence is high for explicit confirm text', () => {
    expect(confirmIntentConfidence('please confirm application now')).toBeGreaterThanOrEqual(0.8);
    expect(confirmIntentConfidence('yes')).toBeLessThan(0.75);
  });
});
