import { DecisionRequest } from "@sentinel/contracts";

/** The contract decides: the same schema the server checks (3 to 1000 characters after trimming). */
export const canSubmitRefusal = (text: string): boolean => DecisionRequest.safeParse({ decision: "refuse", reason: text }).success;

/** The most the reason box takes, read from the same schema. */
export const REASON_MAX_LENGTH = DecisionRequest.options[1].shape.reason.maxLength ?? undefined;
