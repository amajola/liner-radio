import { FileAudio, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Modal } from "../../../shared/components/Modal";
import { useUiStore } from "../../../stores/ui-store";
import {
  ACCEPTED_AUDIO,
  formatFileSize,
  readAudioDuration,
  titleFromFileName,
} from "../audio-duration";
import { useUploadTrack } from "../use-upload-track";

export function UploadTrackModal({
  open,
  onClose,
  ownerId,
  initialFile,
}: {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  initialFile?: File | null;
}) {
  const upload = useUploadTrack();
  const showError = useUiStore((state) => state.showError);
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [dragging, setDragging] = useState(false);

  function takeFile(next: File | null) {
    setFile(next);
    if (next) setTitle((current) => current || titleFromFileName(next.name));
  }

  useEffect(() => {
    if (open && initialFile) takeFile(initialFile);
    if (!open) {
      setTitle("");
      setArtist("");
      setFile(null);
      setRightsConfirmed(false);
      setDragging(false);
      if (fileInput.current) fileInput.current.value = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.files).find((item) =>
      item.type.startsWith("audio/"),
    );
    if (!dropped) {
      showError("Drop an MP3, M4A, WAV, OGG or WebM audio file.");
      return;
    }
    takeFile(dropped);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;

    let duration: number;
    try {
      duration = await readAudioDuration(file);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "The audio file could not be read.");
      return;
    }

    try {
      await upload.mutateAsync({ ownerId, title, artist, file, duration, rightsConfirmed });
      onClose();
    } catch {
      // The mutation owns its transient error notice.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload music"
      subtitle="MP3, M4A, WAV, OGG or WebM · up to 30 MB"
    >
      <form className="upload-modal-form" onSubmit={submit}>
        <label
          className={`drop-zone ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <FileAudio size={26} strokeWidth={1.5} />
          <strong>{file ? file.name : "Drag an audio file here"}</strong>
          <span>
            {file
              ? `${formatFileSize(file.size)} · click to replace`
              : "or click to choose from your device"}
          </span>
          {/* Not `required`: a dragged-in file lives in state and never reaches
              this input, which would leave the form permanently invalid. The
              submit button and `submit` both gate on `file` instead. */}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_AUDIO}
            onChange={(event) => takeFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <div className="upload-fields">
          <label>
            Track title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={180}
              required
            />
          </label>
          <label>
            Artist
            <input
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              maxLength={180}
              required
            />
          </label>
        </div>

        <label className="rights-check">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
            required
          />
          <span>I own this audio or have permission to stream it to this room.</span>
        </label>

        <button className="primary-button" disabled={upload.isPending || !file}>
          {upload.isPending ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
          {upload.isPending ? "Uploading…" : "Add to library"}
        </button>
      </form>
    </Modal>
  );
}
