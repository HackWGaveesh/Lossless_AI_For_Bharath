import { parseBudgetThresholdFromMessage, resolveBudgetModeFromThreshold } from '../../src/services/runtime-config-service.js';

describe('runtime-config-service', () => {
  test('parses threshold from JSON payload', () => {
    const threshold = parseBudgetThresholdFromMessage('{"threshold":45,"budgetName":"VaaniSetu"}');
    expect(threshold).toBe(45);
  });

  test('parses threshold from text payload', () => {
    const message = 'The forecasted cost is greater than your alert threshold of USD 50.00 for budget VaaniSetu.';
    const threshold = parseBudgetThresholdFromMessage(message);
    expect(threshold).toBe(50);
  });

  test('maps thresholds to expected budget modes', () => {
    expect(resolveBudgetModeFromThreshold(20)).toBe('normal');
    expect(resolveBudgetModeFromThreshold(35)).toBe('guarded');
    expect(resolveBudgetModeFromThreshold(45)).toBe('guarded');
    expect(resolveBudgetModeFromThreshold(50)).toBe('strict');
  });
});
