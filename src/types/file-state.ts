export type FileStatus = "queued" | "uploading" | "done" | "error";

export interface FileState {
  file: File;
  status: FileStatus;
  s3Key?: string;
  dims?: { width: number; height: number };
  error?: string;
}
