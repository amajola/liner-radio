import { create } from "zustand";

export type MobileView = "now" | "queue" | "requests";
export type Toast = { kind: "error" | "notice"; message: string } | null;

type UiState = {
  activeRoomId: string | null;
  mobileView: MobileView;
  toast: Toast;
  enterRoom: (roomId: string) => void;
  leaveRoom: () => void;
  setMobileView: (view: MobileView) => void;
  showError: (message: string) => void;
  showNotice: (message: string) => void;
  clearToast: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeRoomId: null,
  mobileView: "now",
  toast: null,
  enterRoom: (roomId) => {
    history.replaceState(null, "", `/?room=${roomId}`);
    set({ activeRoomId: roomId, mobileView: "now" });
  },
  leaveRoom: () => {
    history.replaceState(null, "", "/");
    set({ activeRoomId: null, mobileView: "now" });
  },
  setMobileView: (mobileView) => set({ mobileView }),
  showError: (message) => set({ toast: { kind: "error", message } }),
  showNotice: (message) => set({ toast: { kind: "notice", message } }),
  clearToast: () => set({ toast: null }),
}));
