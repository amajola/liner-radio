import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, LoaderCircle, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "../../../shared/http";
import { Modal } from "../../../shared/components/Modal";
import { useUiStore } from "../../../stores/ui-store";
import type { SessionUser } from "../../radio/queries";
import { authClient } from "../../../auth-client";
import { authKeys } from "../queries";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly user: SessionUser;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function AccountModal({ open, onClose, user }: Props) {
  const [name, setName] = useState(user.name);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const queryClient = useQueryClient();
  const showNotice = useUiStore((state) => state.showNotice);
  const showError = useUiStore((state) => state.showError);

  useEffect(() => {
    if (!open) return;
    setName(user.name);
    setImage(null);
    setRemoveImage(false);
  }, [open, user.name]);

  const preview = useMemo(
    () => (image ? URL.createObjectURL(image) : removeImage ? null : user.image),
    [image, removeImage, user.image],
  );
  useEffect(
    () => () => {
      if (image && preview) URL.revokeObjectURL(preview);
    },
    [image, preview],
  );

  const save = useMutation({
    mutationKey: [...authKeys.all, "update-profile"],
    mutationFn: async () => {
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Enter a display name.");
      const profile = await authClient.updateUser({
        name: normalizedName,
      });
      if (profile.error) throw new Error(profile.error.message || "Unable to update your profile.");
      if (image) {
        const body = new FormData();
        body.set("image", image);
        await apiRequest<{ image: string }>("/api/profile/image", { method: "POST", body });
      } else if (removeImage) {
        await apiRequest<{ image: null }>("/api/profile/image", { method: "DELETE" });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.session(), exact: true });
      showNotice("Profile updated.");
      onClose();
    },
    onError: (error) => showError(error.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Your profile" subtitle="How people see you in listening rooms.">
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-picture-editor">
          <div className="profile-avatar profile-avatar-large">
            {preview ? <img src={preview} alt="Profile preview" /> : initials(name) || <UserRound />}
          </div>
          <div>
            <label className="secondary-button image-picker">
              <Camera size={17} />Choose picture
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const next = event.target.files?.[0] || null;
                  if (next && next.size > 3 * 1024 * 1024) {
                    showError("Profile pictures can be up to 3 MB.");
                    event.target.value = "";
                    return;
                  }
                  setImage(next);
                  setRemoveImage(false);
                }}
              />
            </label>
            {(preview || image) && (
              <button className="text-action profile-remove" type="button" onClick={() => { setImage(null); setRemoveImage(true); }}>
                <Trash2 size={15} />Remove picture
              </button>
            )}
            <small>JPEG, PNG or WebP. Maximum 3 MB.</small>
          </div>
        </div>
        <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <label>Email<input value={user.email || ""} disabled /></label>
        <p className="verification-state">{user.emailVerified ? "Email verified" : "Email awaiting verification"}</p>
        <button className="primary-button" disabled={save.isPending}>
          {save.isPending && <LoaderCircle className="spin" size={17} />}Save profile
        </button>
      </form>
    </Modal>
  );
}
