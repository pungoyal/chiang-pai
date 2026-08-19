"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { clearAvatarAction, setAvatarAction } from "@/app/actions";

const SIDE = 256;

/**
 * Center-crop to a square and downscale before upload, so any phone photo
 * lands well under the server's 512 KB cap.
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const crop = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    SIDE,
    SIDE,
  );
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      0.85,
    );
  });
}

/** Shown only on your own member page: upload a picture that replaces the monogram. */
export function AvatarPicker({ hasCustom }: { hasCustom: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const upload = (file: File) =>
    startTransition(async () => {
      setError(null);
      let blob: Blob;
      try {
        blob = await downscale(file);
      } catch {
        setError("Couldn't read that image. Try a JPEG or PNG.");
        return;
      }
      const formData = new FormData();
      formData.append("avatar", blob, "avatar.jpg");
      const res = await setAvatarAction(formData);
      if (!res.ok) setError(res.error ?? "That didn't work.");
      else router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const res = await clearAvatarAction();
      if (!res.ok) setError(res.error ?? "That didn't work.");
      else router.refresh();
    });

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload(file);
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold hover:bg-line/40 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Change picture"}
        </button>
        {hasCustom && (
          <button
            type="button"
            disabled={pending}
            onClick={remove}
            className="rounded-md px-2 py-1 text-xs text-soft hover:underline disabled:opacity-40"
          >
            Use my initials
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
