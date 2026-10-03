"use client";

// Server state for the document list. TanStack Query owns the cache; components only
// call these hooks.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteDocument, getDocumentChunks, listDocuments, uploadDocument } from "../api";
import { checkUpload } from "../pipeline";
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

export type UploadProblem = { id: string; filename: string; message: string };

// Uploads files one request each (the API takes one file per request). Each one appears
// in the list as soon as the server accepts it (202), which also starts polling.
export function useUploadDocuments() {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState<string[]>([]); // filenames in flight
  const [problems, setProblems] = useState<UploadProblem[]>([]);

  const report = (filename: string, message: string) =>
    setProblems((list) => [...list, { id: crypto.randomUUID(), filename, message }]);

  async function uploadOne(file: File) {
    setUploading((list) => [...list, file.name]);
    try {
      const document = await uploadDocument(file);
      // Show it now rather than on the next poll, then let the server's list confirm it.
      queryClient.setQueryData<DocumentListItem[]>(documentsKey, (list = []) =>
        list.some((d) => d.id === document.id) ? list : [{ ...document, chunkCount: 0 }, ...list],
      );
      void queryClient.invalidateQueries({ queryKey: documentsKey });
    } catch (error) {
      report(file.name, error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading((list) => {
        const index = list.indexOf(file.name);
        return index === -1 ? list : [...list.slice(0, index), ...list.slice(index + 1)];
      });
    }
  }

  function upload(files: File[]) {
    for (const file of files) {
      const problem = checkUpload(file);
      if (problem) report(file.name, problem);
      else void uploadOne(file);
    }
  }

  const dismiss = (id: string) => setProblems((list) => list.filter((p) => p.id !== id));

  return { upload, uploading, problems, dismiss };
}

export function useDocumentChunks(id: string) {
  return useQuery({
    queryKey: ["document-chunks", id], // not under documentsKey, so list refreshes leave it alone
    queryFn: ({ signal }) => getDocumentChunks(id, signal),
    staleTime: Infinity, // a ready document's chunks never change
  });
}
