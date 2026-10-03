"use client";

// Server state for the document list. TanStack Query owns the cache; components only
// call these hooks.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDocument, listDocuments } from "../api";
import type { DocumentListItem } from "../types";

export const documentsKey = ["documents"] as const;

// How often to re-fetch while a document is processing. Extracting and chunking take
// milliseconds and embedding batches land about a minute apart, so faster gains nothing.
const POLL_MS = 1_500;

export function useDocuments() {
  return useQuery({
    queryKey: documentsKey,
    queryFn: ({ signal }) => listDocuments(signal),
    // Poll only while something is still processing; once everything is ready or failed
    // this returns false and the polling stops by itself. (Polling also pauses while the
    // tab is in the background, and refetches when you come back to it.)
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === "processing") ? POLL_MS : false),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (document: DocumentListItem) => deleteDocument(document.id),

    // Optimistic: the row disappears immediately instead of after the round trip. The
    // previous list is kept so a failed delete can put the row back.
    onMutate: async (document) => {
      // Stop an in-flight poll from landing afterwards and restoring the deleted row.
      await queryClient.cancelQueries({ queryKey: documentsKey });
      const previous = queryClient.getQueryData<DocumentListItem[]>(documentsKey);
      queryClient.setQueryData<DocumentListItem[]>(documentsKey, (list) => list?.filter((d) => d.id !== document.id));
      return { previous };
    },

    onError: (error, document, context) => {
      // A 404 means it's already gone (deleted in another tab): nothing to restore.
      if ((error as { status?: number }).status === 404) return;
      if (context?.previous) queryClient.setQueryData(documentsKey, context.previous);
    },

    // Either way, re-sync with the server.
    onSettled: () => queryClient.invalidateQueries({ queryKey: documentsKey }),
  });
}
