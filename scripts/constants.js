export const MODULE_ID = 'pf2e-hazarder';
export const PLAN_VERSION = 1;
export const STATE_VERSION = 1;
export const TAG_PREFIX = 'hazarder:instance:';

export const STATUS = Object.freeze({
  ARMED: 'armed',
  TRIGGERED: 'triggered',
  ACTIVE: 'active',
  DISABLED: 'disabled',
  RESET: 'reset',
});

export const DEGREE = Object.freeze({ CRIT_FAIL: 0, FAIL: 1, SUCCESS: 2, CRIT_SUCCESS: 3 });

export const OUTCOME_TO_DEGREE = Object.freeze({
  criticalFailure: DEGREE.CRIT_FAIL,
  failure: DEGREE.FAIL,
  success: DEGREE.SUCCESS,
  criticalSuccess: DEGREE.CRIT_SUCCESS,
});
