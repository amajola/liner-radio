import { create } from "zustand";

export type UploadStatus = "queued" | "reading" | "uploading" | "saving" | "complete" | "error" | "cancelled";

export type UploadJob = {
  id: string;
  ownerId: string;
  fileName: string;
  title: string;
  artist: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  controller: AbortController;
};

type UploadState = {
  jobs: UploadJob[];
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  add: (job: UploadJob) => void;
  update: (id: string, patch: Partial<Omit<UploadJob, "id" | "controller">>) => void;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
};

export const useUploadStore = create<UploadState>((set, get) => ({
  jobs: [],
  expanded: true,
  setExpanded: (expanded) => set({ expanded }),
  add: (job) => set((state) => ({ jobs: [...state.jobs, job], expanded: true })),
  update: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    })),
  cancel: (id) => {
    const job = get().jobs.find((candidate) => candidate.id === id);
    job?.controller.abort();
    set((state) => ({
      jobs: state.jobs.map((candidate) =>
        candidate.id === id ? { ...candidate, status: "cancelled" as const } : candidate,
      ),
    }));
  },
  dismiss: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  clearFinished: () =>
    set((state) => ({
      jobs: state.jobs.filter((job) => job.status === "queued" || job.status === "reading" || job.status === "uploading" || job.status === "saving"),
    })),
}));

export function createUploadJob(input: {
  ownerId: string;
  fileName: string;
  title: string;
  artist: string;
}) {
  return {
    id: crypto.randomUUID(),
    ...input,
    progress: 0,
    status: "queued" as const,
    controller: new AbortController(),
  } satisfies UploadJob;
}
