# Music feature map

The feature is intentionally split by responsibility so UI changes do not
touch the large-file transport:

- `components/AddMusicModal.tsx` — file intake, tag review, manual edits, and
  MusicBrainz suggestions.
- `components/UploadDropzone.tsx` and `components/UploadReview.tsx` — the
  upload journey's presentation; `upload-journey.css` owns its scoped styles.
  The review keeps title and artist prominent, with optional fields behind
  “More details” and the confirmation button in the fixed modal footer.
- `embedded-metadata.ts` — lazy browser-side tag parsing (`music-metadata`).
- `background-upload.ts` — the two-lane upload coordinator. This is the only
  bridge between intake metadata and the multipart uploader.
- `use-upload-track.ts` — direct/multipart R2 transport. It contains no album
  UI or catalogue decisions.
- `upload-store.ts` + `components/UploadShelf.tsx` — app-wide progress and
  cancellation that survive modal/navigation changes.
- `components/LibraryModal.tsx` — song, album, artist, and genre browsing.
- `queries.ts` — all music server-state keys and response types.

The Worker mirrors that boundary: `worker/tracks.ts` owns bytes and playback;
`worker/music-catalog.ts` owns album records, searchable metadata, artwork
links, and MusicBrainz lookup. `audio_tracks` remains the authoritative list of
playable objects, while `track_metadata` can change without moving those
objects in R2.
