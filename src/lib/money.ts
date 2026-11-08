export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function hasAtMostTwoDecimalPlaces(amount: number): boolean {
  return Number.isFinite(amount) && Math.abs(amount * 100 - toMinorUnits(amount)) < 1e-7;
}
