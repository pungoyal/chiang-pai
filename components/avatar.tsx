import { avatarSrc, avatarTint, initials } from "@/lib/avatar";

export interface AvatarMember {
  id: string;
  name: string;
  avatarUpdatedAt: Date | null;
}

/**
 * A member's picture: their upload if they have one, otherwise a monogram
 * generated from their name and id. Everyone has a face from the moment they
 * join — nothing is fetched from anywhere else.
 */
export function Avatar({ member, size = 32 }: { member: AvatarMember; size?: number }) {
  const src = avatarSrc(member);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny same-origin avatars, no optimization needed
      <img src={src} alt={member.name} width={size} height={size} className="rounded-full" />
    );
  }

  const [from, to] = avatarTint(member.id);
  return (
    <span
      className="display inline-flex shrink-0 items-center justify-center rounded-full font-bold uppercase text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        fontSize: size * 0.42,
        letterSpacing: size * 0.01,
      }}
      title={member.name}
    >
      {initials(member.name)}
    </span>
  );
}
