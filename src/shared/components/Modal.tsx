import { motion } from "motion/react";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "compact" | "tall" | "studio" | "upload";
  /**
   * Guards the close paths. Return a question to ask before closing, or null to
   * close immediately. Checked on Escape, the backdrop and the close button;
   * calling `onClose` directly (a successful submit, say) bypasses it.
   */
  confirmClose?: () => string | null;
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "compact",
  confirmClose,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const confirmPanel = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const confirmId = useId();
  const [question, setQuestion] = useState<string | null>(null);

  // Read through refs so the focus trap below depends only on `open`. Callers
  // routinely pass an inline arrow for `onClose`, and re-running the trap on
  // every parent render would pull focus out of whatever the person is typing
  // in — which is what broke text selection and caret navigation in dialogs.
  const onCloseRef = useRef(onClose);
  const confirmCloseRef = useRef(confirmClose);
  onCloseRef.current = onClose;
  confirmCloseRef.current = confirmClose;

  // While the confirmation is up it owns the dialog, so Tab must cycle inside
  // it rather than through the form it is covering.
  const focusables = useCallback(
    () =>
      Array.from(
        (confirmPanel.current ?? surface.current)?.querySelectorAll<HTMLElement>(
          FOCUSABLE,
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0),
    [],
  );

  const requestClose = useCallback(() => {
    const asked = confirmCloseRef.current?.() ?? null;
    if (asked) {
      setQuestion(asked);
      return;
    }
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    (focusables()[0] ?? surface.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        // Escape dismisses the question rather than answering it, so it can
        // never discard work by being pressed twice.
        if (confirmPanel.current) setQuestion(null);
        else requestClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Keep Tab inside the dialog; a modal that leaks focus to the page behind
      // it is unusable with a keyboard or a screen reader.
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const root = confirmPanel.current ?? surface.current;
      if (event.shiftKey && (active === first || !root?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreFocus.current?.focus?.();
    };
  }, [focusables, open, requestClose]);

  // A dialog that reopens must not still be holding the last question.
  useEffect(() => {
    if (!open) setQuestion(null);
  }, [open]);

  useEffect(() => {
    if (question) keepEditing.current?.focus();
  }, [question]);

  // Deliberately mounted and unmounted outright rather than wrapped in
  // AnimatePresence: an exit animation that fails to complete leaves the dialog
  // stuck on screen after it has already closed in state. Entrance only.
  if (!open) return null;

  return createPortal(
    <motion.div
      className="modal-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <motion.div
        ref={surface}
        className={`surface surface--lg modal-surface modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="btn btn--ghost btn--sm btn--icon"
            type="button"
            onClick={requestClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}

        {question && (
          <div className="modal-confirm">
            <div
              ref={confirmPanel}
              className="modal-confirm-panel"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={confirmId}
            >
              <p id={confirmId}>{question}</p>
              <div className="modal-confirm-actions">
                <button
                  ref={keepEditing}
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => setQuestion(null)}
                >
                  Keep editing
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => {
                    setQuestion(null);
                    onCloseRef.current();
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
