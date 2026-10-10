import { DEGREE, OUTCOME_TO_DEGREE, STATUS, TAG_PREFIX, MODULE_ID } from '../scripts/constants.js';

test('constants match the spec', () => {
  expect(MODULE_ID).toBe('pf2e-hazarder');
  expect(TAG_PREFIX).toBe('hazarder:instance:');
  expect(Object.values(STATUS).sort()).toEqual([
    'active',
    'armed',
    'disabled',
    'reset',
    'triggered',
  ]);
  expect(OUTCOME_TO_DEGREE.criticalSuccess).toBe(DEGREE.CRIT_SUCCESS);
  expect(OUTCOME_TO_DEGREE.criticalFailure).toBe(DEGREE.CRIT_FAIL);
});
