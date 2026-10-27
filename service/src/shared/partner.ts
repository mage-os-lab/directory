/** "Gold partner" for the browse UI and the prerendered pages alike. */
export function partnerLabel(tier: string): string {
  return `${tier[0].toUpperCase()}${tier.slice(1)} partner`;
}
