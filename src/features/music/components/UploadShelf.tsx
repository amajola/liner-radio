import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Disc3,
  Headphones,
  LoaderCircle,
  X,
} from "lucide-react";
import { useId } from "react";
import { useUploadStore, type UploadJob } from "../upload-store";

const running = (job: UploadJob) =>
  ["queued", "reading", "uploading", "saving"].includes(job.status);

function statusLabel(job: UploadJob) {
  if (job.status === "queued") return "Waiting";
  if (job.status === "reading") return "Reading details";
  if (job.status === "uploading") return `${Math.round(job.progress * 100)}%`;
  if (job.status === "saving") return "Finishing";
  if (job.status === "complete") return "In your library";
  if (job.status === "cancelled") return "Cancelled";
  return "Needs attention";
}

export function UploadShelf() {
  const jobs = useUploadStore((state) => state.jobs);
  const expanded = useUploadStore((state) => state.expanded);
  const setExpanded = useUploadStore((state) => state.setExpanded);
  const cancel = useUploadStore((state) => state.cancel);
  const dismiss = useUploadStore((state) => state.dismiss);
  const clearFinished = useUploadStore((state) => state.clearFinished);
  const bodyId = useId();
  const active = jobs.filter(running);
  const complete = jobs.filter((job) => job.status === "complete").length;
  const errors = jobs.filter((job) => job.status === "error").length;
  // Completed tracks stay in the denominator so progress does not fall back
  // to zero as soon as one track finishes.
  const relevant = jobs.filter(
    (job) => !["error", "cancelled"].includes(job.status),
  );
  const progress = relevant.length
    ? relevant.reduce(
        (sum, job) => sum + (job.status === "complete" ? 1 : job.progress),
        0,
      ) / relevant.length
    : 0;
  const title = active.length
    ? "Making room for your music"
    : errors
      ? "Some tracks need attention"
      : complete
        ? "Your music is in"
        : "Uploads cancelled";
  const detail = active.length
    ? `${complete} of ${jobs.length} added · ${Math.round(progress * 100)}%`
    : errors
      ? `${errors} upload${errors === 1 ? "" : "s"} didn’t finish`
      : `${complete} track${complete === 1 ? "" : "s"} added to your library`;

  if (!jobs.length) return null;

  return (
    <motion.aside
      className="upload-shelf upload-shelf--compact"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Background uploads"
    >
      <div className="upload-dock-top">
        <button
          className="upload-dock-toggle"
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <span
            className={`upload-dock-mark ${errors && !active.length ? "has-error" : ""}`}
          >
            {active.length ? (
              <Disc3 size={23} />
            ) : errors ? (
              <AlertCircle size={22} />
            ) : complete ? (
              <Check size={22} />
            ) : (
              <X size={22} />
            )}
          </span>
          <span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </span>
          <ChevronDown size={16} className={expanded ? "is-open" : ""} />
        </button>
        {!active.length && (
          <button
            className="upload-dock-close"
            type="button"
            aria-label="Dismiss finished uploads"
            onClick={clearFinished}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {active.length > 0 && (
        <div
          className="upload-dock-progress"
          role="progressbar"
          aria-label="Overall upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={bodyId}
            className="upload-dock-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="upload-dock-jobs">
              {jobs.map((job) => (
                <div
                  className={`upload-dock-job status-${job.status}`}
                  key={job.id}
                >
                  <span className="upload-dock-job-icon">
                    {job.status === "queued" ? (
                      <Disc3 size={16} />
                    ) : running(job) ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : job.status === "complete" ? (
                      <Check size={16} />
                    ) : (
                      <AlertCircle size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{job.title}</strong>
                    <small>{job.artist || job.fileName}</small>
                    {job.status === "error" && (
                      <p>
                        {job.error ||
                          "Upload didn’t finish. Add this file again to retry."}
                      </p>
                    )}
                  </div>
                  <span className="upload-dock-job-status">
                    {statusLabel(job)}
                  </span>
                  <button
                    type="button"
                    className="upload-dock-close"
                    onClick={() =>
                      running(job) ? cancel(job.id) : dismiss(job.id)
                    }
                    aria-label={`${running(job) ? "Cancel" : "Dismiss"} ${job.title}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="upload-dock-footer">
              <span>
                <Headphones size={14} />
                {active.length
                  ? "Keep this tab open. Keep listening."
                  : "Ready when you are."}
              </span>
              {jobs.some((job) => !running(job)) && (
                <button type="button" onClick={clearFinished}>
                  Clear finished
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="upload-sr-only" role="status">
        {active.length ? `${active.length} uploads in progress` : title}
      </span>
    </motion.aside>
  );
}
