import {
  ArrowUpRight,
  Check,
  Disc3,
  Headphones,
  Sparkles,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { MAXIMUM_TRACK_BYTES } from "../../../../lib/http/upload-limits";
import { ACCEPTED_AUDIO } from "../audio-duration";

export function UploadDropzone({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="upload-welcome">
      <div
        className={`upload-drop ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="upload-drop-caption">
          <Disc3 size={16} /> YOUR NEXT ROTATION
        </div>
        <div className="upload-drop-icon">
          <Upload size={32} strokeWidth={1.5} />
        </div>
        <h3>
          {dragging ? (
            "Drop it like it’s hot."
          ) : (
            <>
              Good music.
              <br />
              Bring it in.
            </>
          )}
        </h3>
        <p>
          Drop a track or an entire album here.
          <br />
          We’ll take care of the details.
        </p>
        <button
          className="btn btn--accent btn--lg"
          type="button"
          onClick={() => input.current?.click()}
        >
          Choose audio files <ArrowUpRight size={18} />
        </button>
        <input
          ref={input}
          className="upload-file-input"
          type="file"
          accept={ACCEPTED_AUDIO}
          multiple
          tabIndex={-1}
          aria-label="Choose audio files"
          onChange={(event) => {
            onFiles(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
        <div className="upload-drop-formats">
          <span>MP3 · M4A · WAV · FLAC · OGG · WebM</span>
          <span>
            Up to {Math.round(MAXIMUM_TRACK_BYTES / 1024 / 1024)} MB per file
          </span>
        </div>
      </div>
      <aside className="upload-welcome-aside">
        <span className="upload-eyebrow">FROM YOUR FILES TO THE ROOM</span>
        <h3>
          A little less admin.
          <br />A lot more music.
        </h3>
        <ol className="upload-explainer">
          <li>
            <span>
              <Disc3 size={18} />
            </span>
            <div>
              <strong>Bring your collection</strong>
              <p>Add a single song or a whole stack.</p>
            </div>
          </li>
          <li>
            <span>
              <Sparkles size={18} />
            </span>
            <div>
              <strong>Check the details</strong>
              <p>We read your tags and find matches. You get the final say.</p>
            </div>
          </li>
          <li>
            <span>
              <Headphones size={18} />
            </span>
            <div>
              <strong>Keep the music going</strong>
              <p>Uploads carry on while you use the app.</p>
            </div>
          </li>
        </ol>
        <div className="upload-local-note">
          <Check size={15} />
          <span>Nothing uploads until you’re ready.</span>
        </div>
      </aside>
    </div>
  );
}
