/**
 * VaaniSetu Scheme Eligibility Service — Single Source of Truth
 *
 * Replaces both scoreScheme() in action-handler.ts and
 * calculateEligibility() in schemes/search.ts.
 *
 * Design principles:
 *   1. Hard-exclusion gates: if user clearly doesn't qualify, score = 0 immediately.
 *   2. genderOrCaste flag: Stand-Up India and similar schemes require SC/ST OR female.
 *   3. matchReasons + exclusionReasons returned for transparent UI.
 *   4. Graceful degradation: missing profile fields never trigger hard exclusion.
 */

export interface UserProfile {
  age?: number;
  gender?: string;
  occupation?: string;
  annualIncome?: number;
  income?: number;          // alias used in some call sites
  casteCategory?: string;
  caste_category?: string;  // DynamoDB snake_case alias
  state?: string;
  bplCardholder?: boolean;
  bpl_cardholder?: boolean;
  shg_member?: boolean;
  ration_card?: boolean;
}

export interface EligibilityResult {
  score: number;           // 0-100
  eligible: boolean;       // true if no hard-exclusion triggered AND score > 0
  matchReasons: string[];  // positive reasons shown to user
  exclusionReasons: string[]; // why user is NOT eligible (empty if eligible)
}

function normalise(s?: string): string {
  return (s || '').trim().toLowerCase();
}

/**
 * Core eligibility evaluator.
 * @param criteria  Raw eligibility_criteria JSON from scheme data
 * @param profile   User profile object (DynamoDB or request body)
 */
export function evaluateEligibility(
  criteria: Record<string, any>,
  profile: UserProfile,
): EligibilityResult {
  const matchReasons: string[] = [];
  const exclusionReasons: string[] = [];
  let score = 0;
  let maxScore = 0;

  const userGender = normalise(profile.gender);
  const userCaste = (profile.casteCategory || profile.caste_category || '').trim().toUpperCase();
  const userAge = Number(profile.age ?? 0);
  const userIncome = Number(profile.annualIncome ?? profile.income ?? 0);
  const userOccupation = normalise(profile.occupation);
  const userBpl = profile.bplCardholder ?? profile.bpl_cardholder;

  // ──────────────────────────────────────────────────────────────────────────
  // 1. CASTE / GENDER GATE
  //    genderOrCaste=true  → eligible if SC/ST in casteCategories OR female
  //    genderOrCaste=false → eligible ONLY if in casteCategories (hard exclusion)
  // ──────────────────────────────────────────────────────────────────────────
  const casteCats: string[] = criteria.casteCategories ?? [];
  if (casteCats.length) {
    maxScore += 30;
    const inCaste = userCaste && casteCats.map((c: string) => c.toUpperCase()).includes(userCaste);
    const isFemale = userGender === 'female' || userGender === 'f';

    if (criteria.genderOrCaste) {
      // OR-logic: SC/ST or Women
      if (inCaste || isFemale) {
        score += 30;
        if (inCaste) matchReasons.push(`${userCaste} category eligible`);
        else matchReasons.push('Women entrepreneur eligible');
      } else if (userCaste || userGender) {
        // We know the user's details — they definitely don't qualify
        exclusionReasons.push(`Requires SC/ST category or Women entrepreneur – not applicable for ${userCaste || userGender} applicants`);
        return { score: 0, eligible: false, matchReasons, exclusionReasons };
      }
      // If we have no caste/gender info, skip gate (graceful)
    } else {
      // AND-logic: must be in casteCategories
      if (inCaste) {
        score += 30;
        matchReasons.push(`${userCaste} category eligible`);
      } else if (userCaste) {
        // Known caste that's not in list — hard exclusion
        exclusionReasons.push(`Requires ${casteCats.join('/')} category (your category: ${userCaste})`);
        return { score: 0, eligible: false, matchReasons, exclusionReasons };
      }
      // No caste info → no penalty, no reward
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. GENDER GATE (standalone — only applies when casteCategories is absent)
  //    gender:"female"/"male" → hard exclusion for non-matching gender
  //    gender:"all"/"any" → no restriction
  // ──────────────────────────────────────────────────────────────────────────
  const requiredGender = normalise(criteria.gender);
  if (!casteCats.length && requiredGender && requiredGender !== 'all' && requiredGender !== 'any') {
    maxScore += 15;
    const genderTarget = requiredGender === 'f' ? 'female' : requiredGender === 'm' ? 'male' : requiredGender;
    if (userGender === genderTarget || userGender === genderTarget[0]) {
      score += 15;
      matchReasons.push(`${genderTarget} eligibility matched`);
    } else if (userGender) {
      exclusionReasons.push(`This scheme requires ${genderTarget} applicants`);
      return { score: 0, eligible: false, matchReasons, exclusionReasons };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. AGE GATE — hard exclusion if age known and outside range
  // ──────────────────────────────────────────────────────────────────────────
  const ageMin = criteria.ageMin != null ? Number(criteria.ageMin) : null;
  const ageMax = criteria.ageMax != null ? Number(criteria.ageMax) : null;
  if (ageMin != null || ageMax != null) {
    maxScore += 20;
    if (userAge > 0) {
      const okMin = ageMin == null || userAge >= ageMin;
      const okMax = ageMax == null || userAge <= ageMax;
      if (okMin && okMax) {
        score += 20;
        const rangeStr = ageMin != null && ageMax != null
          ? `${ageMin}–${ageMax}`
          : ageMin != null ? `≥${ageMin}` : `≤${ageMax}`;
        matchReasons.push(`Age ${userAge} within eligibility (${rangeStr})`);
      } else {
        const reason = !okMin
          ? `Age ${userAge} is below minimum age ${ageMin}`
          : `Age ${userAge} exceeds maximum age ${ageMax}`;
        exclusionReasons.push(reason);
        return { score: 0, eligible: false, matchReasons, exclusionReasons };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. INCOME GATE — hard exclusion only if income clearly exceeds limit
  // ──────────────────────────────────────────────────────────────────────────
  const incomeMax = criteria.incomeMax != null ? Number(criteria.incomeMax) : null;
  if (incomeMax != null) {
    maxScore += 25;
    if (userIncome > 0) {
      if (userIncome <= incomeMax) {
        score += 25;
        matchReasons.push(`Income ₹${userIncome.toLocaleString('en-IN')} within ₹${incomeMax.toLocaleString('en-IN')} limit`);
      } else {
        exclusionReasons.push(`Annual income ₹${userIncome.toLocaleString('en-IN')} exceeds scheme limit of ₹${incomeMax.toLocaleString('en-IN')}`);
        return { score: 0, eligible: false, matchReasons, exclusionReasons };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. OCCUPATION SOFT MATCH — no hard exclusion (just score)
  // ──────────────────────────────────────────────────────────────────────────
  const occupations: string[] = criteria.occupation ?? [];
  if (occupations.length && userOccupation) {
    maxScore += 15;
    const oNorm = userOccupation.replace(/-/g, '_');
    const matched = occupations.some(
      (o: string) => oNorm.includes(normalise(o)) || normalise(o).includes(oNorm)
    );
    if (matched) {
      score += 15;
      matchReasons.push(`Occupation "${profile.occupation}" matches scheme requirements`);
    } else {
      // Soft miss — lower score but don't hard-exclude (user may have mixed livelihood)
      score += 0;
    }
  } else if (occupations.length === 0) {
    // Open to all occupations
    maxScore += 5;
    score += 5;
    matchReasons.push('Open to all occupations');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. BPL GATE
  // ──────────────────────────────────────────────────────────────────────────
  if (criteria.bpl === true) {
    maxScore += 20;
    if (userBpl === true) {
      score += 20;
      matchReasons.push('BPL cardholder eligible');
    } else if (userBpl === false) {
      exclusionReasons.push('Requires BPL (Below Poverty Line) card');
      return { score: 0, eligible: false, matchReasons, exclusionReasons };
    }
    // userBpl undefined → graceful skip
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. SHG MEMBER gate (for NRLM-type schemes)
  // ──────────────────────────────────────────────────────────────────────────
  if (criteria.shg_member === true) {
    maxScore += 15;
    if (profile.shg_member === true) {
      score += 15;
      matchReasons.push('SHG member eligible');
    }
    // Not a hard exclusion — SHG membership easy to verify at bank
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. RATION CARD gate
  // ──────────────────────────────────────────────────────────────────────────
  if (criteria.ration_card === true) {
    maxScore += 10;
    if (profile.ration_card === true) {
      score += 10;
      matchReasons.push('Ration card holder eligible');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Compute final score
  //   maxScore=0 means no criteria specified → open scheme → score 60
  // ──────────────────────────────────────────────────────────────────────────
  const finalScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 60;

  if (finalScore === 0 && exclusionReasons.length === 0 && maxScore > 0) {
    exclusionReasons.push('Your profile does not meet the eligibility criteria for this scheme');
  }

  return {
    score: finalScore,
    eligible: exclusionReasons.length === 0 && (maxScore === 0 || score > 0),
    matchReasons,
    exclusionReasons,
  };
}

/**
 * Convenience: score only (for ranking lists).
 * Returns 0 for hard-excluded, 1-100 otherwise.
 */
export function scoreScheme(criteria: Record<string, any>, profile: UserProfile): number {
  return evaluateEligibility(criteria, profile).score;
}

/**
 * Rank a list of schemes for a user profile.
 * Hard-excluded schemes are placed at the end with score=0 rather than removed,
 * so callers can choose how many to show.
 */
export function rankSchemes<T extends { criteria: Record<string, any> }>(
  schemes: T[],
  profile: UserProfile,
): Array<T & { eligibilityScore: number; matchReasons: string[]; exclusionReasons: string[] }> {
  return schemes
    .map((s) => {
      const result = evaluateEligibility(s.criteria, profile);
      return { ...s, eligibilityScore: result.score, matchReasons: result.matchReasons, exclusionReasons: result.exclusionReasons };
    })
    .sort((a, b) => b.eligibilityScore - a.eligibilityScore);
}
