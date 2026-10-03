"use client";

import { useQuery } from "@tanstack/react-query";
import { listQueries } from "../api";

export const historyKey = ["queries"] as const;

// How many past questions /chat shows. The API has no paging yet (max 50).
export const HISTORY_LIMIT = 20;

export function useQueryHistory() {
  return useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => listQueries(HISTORY_LIMIT, signal),
  });
}
