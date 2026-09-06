import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Album, Disc3, ListMusic, Music2, Plus, Search, Tags, Upload, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { Track } from "../../../../lib/radio/model";
import { EmptyState, ErrorState, LoadingState } from "../../../shared/components/AsyncState";
import { Modal } from "../../../shared/components/Modal";
import { formatDuration, formatFileSize } from "../audio-duration";
import { musicCatalogQueryOptions } from "../queries";

type LibraryView = "songs" | "albums" | "artists" | "genres";
const tabs: Array<{ id: LibraryView; label: string; icon: typeof Music2 }> = [
  { id: "songs", label: "Songs", icon: ListMusic },
  { id: "albums", label: "Albums", icon: Album },
  { id: "artists", label: "Artists", icon: UserRound },
  { id: "genres", label: "Genres", icon: Tags },
];

function Artwork({ track }: { track: Track }) {
  return <span className="library-artwork">{track.artworkUrl ? <img src={track.artworkUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Music2 size={18} />}</span>;
}

export function LibraryModal({ open, onClose, ownerId, canUpload, actionLabel, onPick, disabled, onUpload }: {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  canUpload: boolean;
  actionLabel?: string;
  onPick?: (track: Track) => void;
  disabled?: boolean;
  onUpload: () => void;
}) {
  const catalog = useQuery({ ...musicCatalogQueryOptions(ownerId), enabled: open && Boolean(ownerId) });
  const [term, setTerm] = useState("");
  const [view, setView] = useState<LibraryView>("songs");
  const [facet, setFacet] = useState<{ type: "album" | "artist" | "genre"; value: string; label: string } | null>(null);
  const allTracks = catalog.data?.tracks ?? [];
  const needle = term.trim().toLowerCase();
  const tracks = useMemo(() => allTracks.filter((track) => {
    const matchesTerm = !needle || [track.title, track.artist, track.album, track.genre].filter(Boolean).some((value) => value!.toLowerCase().includes(needle));
    if (!matchesTerm || !facet) return matchesTerm;
    if (facet.type === "album") return track.albumId === facet.value;
    if (facet.type === "artist") return track.artist === facet.value || track.albumArtist === facet.value;
    return track.genre === facet.value;
  }), [allTracks, facet, needle]);
  const artists = useMemo(() => {
    const counts = new Map<string, number>();
    allTracks.forEach((track) => counts.set(track.artist, (counts.get(track.artist) || 0) + 1));
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allTracks]);
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    allTracks.forEach((track) => track.genre && counts.set(track.genre, (counts.get(track.genre) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [allTracks]);
  const totalBytes = allTracks.reduce((sum, track) => sum + (track.bytes || 0), 0);

  function focus(type: "album" | "artist" | "genre", value: string, label = value) {
    setFacet({ type, value, label });
    setView("songs");
  }

  return (
    <Modal open={open} onClose={onClose} size="studio" title={canUpload ? "Music library" : "Host library"} subtitle={`${allTracks.length} track${allTracks.length === 1 ? "" : "s"} · ${catalog.data?.albums.length || 0} album${catalog.data?.albums.length === 1 ? "" : "s"}${totalBytes ? ` · ${formatFileSize(totalBytes)}` : ""}`}>
      <div className="library-toolbar">
        <div className="library-search"><Search size={16} /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search music" aria-label="Search songs, albums, artists and genres" /></div>
        {canUpload && <button className="btn btn--primary" type="button" onClick={onUpload}><Upload size={16} /> Add music</button>}
      </div>
      <nav className="library-tabs" aria-label="Browse music by">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button className={view === tab.id ? "is-active" : ""} type="button" key={tab.id} onClick={() => { setView(tab.id); setFacet(null); }}><Icon size={15} /> {tab.label}{view === tab.id && <motion.span layoutId="library-tab" />}</button>;
        })}
      </nav>
      {catalog.isPending && <LoadingState label="Loading music…" />}
      {catalog.isError && !catalog.data && <ErrorState message={catalog.error.message} retry={() => void catalog.refetch()} />}
      {catalog.data && !allTracks.length && <div className="library-empty"><span><Disc3 size={28} /></span><strong>{canUpload ? "Your library is ready for its first record." : "The host has not added music yet."}</strong>{canUpload && <button className="btn btn--primary" type="button" onClick={onUpload}><Plus size={16} /> Add music</button>}</div>}
      {Boolean(allTracks.length) && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div className="library-browser" key={`${view}-${facet?.value || "all"}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
            {view === "songs" && <>
              {facet && <div className="library-filter"><span>{facet.label}</span><button type="button" onClick={() => setFacet(null)}>Clear <span aria-hidden="true">×</span></button></div>}
              {!tracks.length ? <EmptyState>Nothing matches “{term}”.</EmptyState> : <div className="library-song-list">{tracks.map((track, index) => (
                <motion.article layout className="library-song" key={track.id}>
                  <span className="track-number">{String(index + 1).padStart(2, "0")}</span><Artwork track={track} />
                  <div><strong>{track.title}</strong><p>{track.artist}{track.album ? ` · ${track.album}` : ""}</p></div>
                  <span className="song-genre">{track.genre || "—"}</span><span className="song-duration">{formatDuration(track.duration)}</span>
                  {onPick && <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label={`${actionLabel} ${track.title}`} title={actionLabel} disabled={disabled} onClick={() => onPick(track)}><Plus size={17} /></button>}
                </motion.article>
              ))}</div>}
            </>}
            {view === "albums" && <div className="library-card-grid">
              {catalog.data?.albums.filter((album) => !needle || [album.title, album.albumArtist, album.genre].filter(Boolean).some((value) => value!.toLowerCase().includes(needle))).map((album) => (
                <button className="library-album-card" type="button" key={album.id} onClick={() => focus("album", album.id, album.title)}>
                  <span className="album-cover">{album.artworkUrl ? <img src={album.artworkUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Disc3 size={30} />}</span>
                  <strong>{album.title}</strong><small>{album.albumArtist} · {album.trackCount} track{album.trackCount === 1 ? "" : "s"}</small>
                </button>
              ))}
              {!catalog.data?.albums.length && <EmptyState>Add album details to tracks and they’ll appear here.</EmptyState>}
            </div>}
            {view === "artists" && <div className="library-facet-grid">{artists.filter(([artist]) => !needle || artist.toLowerCase().includes(needle)).map(([artist, count]) => (
              <button type="button" key={artist} onClick={() => focus("artist", artist)}><span className="facet-mark"><UserRound size={19} /></span><span><strong>{artist}</strong><small>{count} track{count === 1 ? "" : "s"}</small></span><Plus size={15} /></button>
            ))}</div>}
            {view === "genres" && (genres.length ? <div className="library-genre-grid">{genres.filter(([genre]) => !needle || genre.toLowerCase().includes(needle)).map(([genre, count], index) => (
              <button type="button" key={genre} onClick={() => focus("genre", genre)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{genre}</strong><small>{count} track{count === 1 ? "" : "s"}</small></button>
            ))}</div> : <EmptyState>Genres appear here as metadata is added.</EmptyState>)}
          </motion.div>
        </AnimatePresence>
      )}
    </Modal>
  );
}
