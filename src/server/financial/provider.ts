/**
 * Extension point for a future financial-data integration (for example Plaid), used to give
 * individual travelers card-benefit and rewards recommendations. Not implemented in the MVP.
 *
 * Constraints any implementation must follow:
 * - Data belongs to one user. It is never shared with other trip members without that user's
 *   explicit, per-item consent, and never included in Atlas context for other members.
 * - Bank credentials are never stored. Use the provider's own authorization flow and keep only the
 *   provider's access token, encrypted at rest, in a table keyed by user (not by trip).
 * - Only rely on data the provider actually exposes. Many rewards balances and card benefits are
 *   not available through aggregation APIs, so recommendations must say what is known.
 *
 * Suggested shape, for when the feature is built:
 */
export interface FinancialDataProvider {
  readonly id: string;
  /** Starts the provider's own link flow for one user and returns what the client needs. */
  createLinkSession(
    userId: string,
  ): Promise<{ linkToken: string; expiresAt: Date }>;
  /** Exchanges the provider's public token for a stored, user-scoped connection. */
  completeLink(
    userId: string,
    publicToken: string,
  ): Promise<{ connectionId: string }>;
  /** Lists the cards the user chose to connect, with only the benefit data the provider exposes. */
  listCards(userId: string): Promise<
    {
      cardId: string;
      displayName: string;
      issuer: string | null;
      knownBenefits: string[];
      rewardsBalance: { amount: number; unit: string; asOf: Date } | null;
    }[]
  >;
  /** Removes the connection and deletes stored tokens and derived data for that user. */
  disconnect(userId: string, connectionId: string): Promise<void>;
}
