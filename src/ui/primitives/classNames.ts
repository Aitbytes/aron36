/** Concatène des classes CSS en ignorant les valeurs vides ou absentes. */
export function cx(...values: readonly (string | false | null | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
