"use client";

import { useUploadDocuments } from "@/lib/hooks/useDocuments";
import { Dropzone } from "./Dropzone";

// Connects the dropzone to the upload logic; the dropzone itself only handles the UI.
export function DocumentUpload() {
  const { upload, uploading, problems, dismiss } = useUploadDocuments();
  return <Dropzone onFiles={upload} uploading={uploading} problems={problems} onDismiss={dismiss} />;
}
