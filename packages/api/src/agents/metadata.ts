/**
 * Provider-agnostic normalization of aggregated LLM metadata into billable usage. Kept free of
 * endpoint and provider imports so lightweight callers (e.g. the memory agent) can use it.
 */

/** Cache-token details in the LangChain-standard normalized shape. */
interface CacheTokenDetails {
  cache_read?: number;
  cache_creation?: number;
}

/** Aggregated LLM metadata entries (shape varies by provider SDK). */
export interface CollectedMetadataEntry {
  usage?: {
    prompt_tokens?: number;
    input_tokens?: number;
    inputTokens?: number;
    completion_tokens?: number;
    output_tokens?: number;
    outputTokens?: number;
    /** Anthropic raw usage. */
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    /** OpenAI raw usage. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
  tokenUsage?: { promptTokens?: number; completionTokens?: number };
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: CacheTokenDetails;
  };
}

export interface ActivityLabelUsage {
  input_tokens?: number;
  output_tokens?: number;
  /** Normalized cache tokens — `computeUsageCostUSD` and the transaction
   *  path read this shape first, so carrying it prices cached label calls
   *  at cache rates instead of the ordinary input rate (or not at all). */
  input_token_details?: CacheTokenDetails;
}

/**
 * Normalizes provider-specific aggregated metadata into the usage shape
 * `recordCollectedUsage` expects, cache-token details included — dropping
 * them made Anthropic cache tokens vanish from billing and charged OpenAI
 * cache reads at the full input rate. Mirrors the title path's inline
 * mapping otherwise.
 */
export function mapCollectedMetadataToUsage(
  collected: CollectedMetadataEntry[],
): ActivityLabelUsage[] {
  return collected.map((item) => {
    let input_tokens: number | undefined;
    let output_tokens: number | undefined;
    let cache_read: number | undefined;
    let cache_creation: number | undefined;
    if (item.usage) {
      input_tokens = item.usage.prompt_tokens ?? item.usage.input_tokens ?? item.usage.inputTokens;
      output_tokens =
        item.usage.completion_tokens ?? item.usage.output_tokens ?? item.usage.outputTokens;
      cache_read =
        item.usage.cache_read_input_tokens ?? item.usage.prompt_tokens_details?.cached_tokens;
      cache_creation = item.usage.cache_creation_input_tokens;
    } else if (item.tokenUsage) {
      input_tokens = item.tokenUsage.promptTokens;
      output_tokens = item.tokenUsage.completionTokens;
    } else if (item.usage_metadata) {
      input_tokens = item.usage_metadata.input_tokens;
      output_tokens = item.usage_metadata.output_tokens;
      cache_read = item.usage_metadata.input_token_details?.cache_read;
      cache_creation = item.usage_metadata.input_token_details?.cache_creation;
    }
    return {
      input_tokens,
      output_tokens,
      ...(cache_read != null || cache_creation != null
        ? { input_token_details: { cache_read, cache_creation } }
        : {}),
    };
  });
}
